// ========================================================================
// 采集系统 - AI 维护：可供模型调用的工具集
//
// 每个工具都标了 readOnly：只读工具随时执行，写工具默认要管理员点确认，
// 只有会话开了「自动执行」才直接落地。工具实现一律走既有的 service 层，
// 不另开一套写库逻辑，免得 REST 与 AI 两条路的行为对不上。
// ========================================================================

import { and, desc, eq, gte, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, t } from '../../../core/db.js';
import { AccountPoolManager } from '../pool-manager.js';
import {
  enqueueCollectionJob,
  getCollectionQueue,
  getQueueStats,
  type CollectionJobType,
} from '../queues/tasks.js';
import { collectionSettingsPatchSchema } from '../settings-schema.js';
import {
  getPoolConfig,
  getScheduleConfig,
  getStorageStrategyConfig,
  setPoolConfig,
  setScheduleConfig,
  setStorageStrategyConfig,
} from '../storage/config.js';
import { batchFromExternalImport, unpublishCollectedVideo } from '../storage/import.js';
import type { LlmToolDefinition } from './llm.js';

const TARGET_SITE = 'yitongkan';

/** 单次工具调用最多创建多少个任务，防止模型一句话铺出几千条队列 */
const MAX_TASKS_PER_CALL = 50;
/** 单次导入的上限，同样是防呆 */
const MAX_IMPORT_PER_CALL = 50;

export interface AiToolContext {
  /** 触发这次维护的管理员，用于导入时的 ownerId 与审计 */
  userId: string;
}

export interface AiTool {
  name: string;
  /** 确认卡片上给管理员看的中文名 */
  label: string;
  description: string;
  readOnly: boolean;
  schema: z.ZodType;
  execute: (args: unknown, ctx: AiToolContext) => Promise<unknown>;
}

function defineTool<S extends z.ZodType>(tool: {
  name: string;
  label: string;
  description: string;
  readOnly: boolean;
  schema: S;
  execute: (args: z.output<S>, ctx: AiToolContext) => Promise<unknown>;
}): AiTool {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    readOnly: tool.readOnly,
    schema: tool.schema,
    execute: (args, ctx) => tool.execute(tool.schema.parse(args ?? {}) as z.output<S>, ctx),
  };
}

/** token 绝不能原样喂给模型，只回显前 8 位够它做判断了 */
function maskToken(token: string): string {
  return `${token.slice(0, 8)}…`;
}

// --------------------------------------------------------------------------
// 只读工具
// --------------------------------------------------------------------------

const getOverview = defineTool({
  name: 'get_overview',
  label: '查看采集总览',
  description:
    '获取采集系统整体状态：号池账号数量与健康度、今日任务与全量任务的成功失败数、采集视频的待导入/已导入数量、BullMQ 队列实时积压。排查问题时优先调用它。',
  readOnly: true,
  schema: z.object({}),
  execute: async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [pool, todayTasks, allTasks, videos, queue] = await Promise.all([
      AccountPoolManager.getInstance().getStats(TARGET_SITE),
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'completed' THEN 1 ELSE 0 END)::int`,
          failed: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'failed' THEN 1 ELSE 0 END)::int`,
          running: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'running' THEN 1 ELSE 0 END)::int`,
          queued: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'queued' THEN 1 ELSE 0 END)::int`,
        })
        .from(t.collectionJobs)
        .where(gte(t.collectionJobs.createdAt, todayStart)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'completed' THEN 1 ELSE 0 END)::int`,
          failed: sql<number>`sum(CASE WHEN ${t.collectionJobs.status} = 'failed' THEN 1 ELSE 0 END)::int`,
        })
        .from(t.collectionJobs),
      db
        .select({
          total: sql<number>`count(*)::int`,
          pending: sql<number>`sum(CASE WHEN ${t.collectedVideos.status} = 'pending' THEN 1 ELSE 0 END)::int`,
          imported: sql<number>`sum(CASE WHEN ${t.collectedVideos.status} = 'imported' THEN 1 ELSE 0 END)::int`,
        })
        .from(t.collectedVideos)
        .where(eq(t.collectedVideos.targetSite, TARGET_SITE)),
      getQueueStats().catch(() => ({ waiting: 0, active: 0, failed: 0, note: 'Redis 不可用' })),
    ]);

    return {
      pool,
      todayTasks: todayTasks[0],
      allTasks: allTasks[0],
      videos: videos[0],
      queue,
    };
  },
});

const getQueueStatus = defineTool({
  name: 'get_queue_stats',
  label: '查看队列状态',
  description: '只读取 BullMQ 采集队列的实时计数（waiting / active / failed），用于判断 worker 是否在消费。',
  readOnly: true,
  schema: z.object({}),
  execute: async () => {
    try {
      return await getQueueStats();
    } catch (error) {
      return {
        error: `无法连接队列：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

const listTasks = defineTool({
  name: 'list_tasks',
  label: '查询采集任务',
  description: '按状态/类型分页查询采集任务记录，返回任务 ID、taskId、状态、重试次数与错误信息。',
  readOnly: true,
  schema: z.object({
    status: z.enum(['queued', 'running', 'completed', 'failed']).optional().describe('任务状态过滤'),
    type: z
      .enum(['list_crawl', 'detail_fetch', 'play_url_refresh', 'r2_transfer'])
      .optional()
      .describe('任务类型过滤'),
    limit: z.number().int().min(1).max(50).default(20).describe('最多返回多少条'),
  }),
  execute: async (args) => {
    const conditions = [eq(t.collectionJobs.targetSite, TARGET_SITE)];
    if (args.status) conditions.push(eq(t.collectionJobs.status, args.status));
    if (args.type) conditions.push(eq(t.collectionJobs.type, args.type));

    const rows = await db
      .select({
        id: t.collectionJobs.id,
        taskId: t.collectionJobs.taskId,
        type: t.collectionJobs.type,
        status: t.collectionJobs.status,
        priority: t.collectionJobs.priority,
        payload: t.collectionJobs.payload,
        retryCount: t.collectionJobs.retryCount,
        errorMessage: t.collectionJobs.errorMessage,
        createdAt: t.collectionJobs.createdAt,
        completedAt: t.collectionJobs.completedAt,
      })
      .from(t.collectionJobs)
      .where(and(...conditions))
      .orderBy(desc(t.collectionJobs.createdAt))
      .limit(args.limit);

    return { count: rows.length, tasks: rows };
  },
});

const listAccounts = defineTool({
  name: 'list_accounts',
  label: '查询号池账号',
  description:
    '查询号池账号列表。token 出于安全只回显前 8 位，需要换 token 时用 update_account 直接覆盖即可，不必先看到完整值。',
  readOnly: true,
  schema: z.object({
    status: z.enum(['active', 'inactive', 'banned']).optional(),
    isVip: z.boolean().optional(),
    search: z.string().max(64).optional().describe('按 uid 或用户名模糊匹配'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async (args) => {
    const result = await AccountPoolManager.getInstance().getList(TARGET_SITE, 1, args.limit, {
      status: args.status,
      isVip: args.isVip,
      search: args.search,
    });
    return {
      total: result.total,
      accounts: result.items.map((acc) => ({ ...acc, token: maskToken(acc.token) })),
    };
  },
});

const listCollectedVideos = defineTool({
  name: 'list_collected_videos',
  label: '查询采集视频',
  description: '查询已采集入库索引（collected_videos）的记录，可按状态、类型、标题关键字过滤。',
  readOnly: true,
  schema: z.object({
    status: z.enum(['pending', 'imported', 'updating', 'archived']).optional(),
    kind: z.enum(['gv', 'mv', 'tv']).optional(),
    search: z.string().max(80).optional().describe('标题关键字'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async (args) => {
    const conditions = [eq(t.collectedVideos.targetSite, TARGET_SITE)];
    if (args.status) conditions.push(eq(t.collectedVideos.status, args.status));
    if (args.kind) conditions.push(eq(t.collectedVideos.kind, args.kind));
    if (args.search) conditions.push(ilike(t.collectedVideos.title, `%${args.search}%`));

    const rows = await db
      .select({
        id: t.collectedVideos.id,
        externalId: t.collectedVideos.externalId,
        title: t.collectedVideos.title,
        kind: t.collectedVideos.kind,
        status: t.collectedVideos.status,
        importMode: t.collectedVideos.importMode,
        videoId: t.collectedVideos.videoId,
        createdAt: t.collectedVideos.createdAt,
      })
      .from(t.collectedVideos)
      .where(and(...conditions))
      .orderBy(desc(t.collectedVideos.createdAt))
      .limit(args.limit);

    return { count: rows.length, videos: rows };
  },
});

const getLogs = defineTool({
  name: 'get_logs',
  label: '查询采集日志',
  description: '查询采集日志，排查任务失败原因时用。可按级别、任务 ID、最近多少分钟过滤。',
  readOnly: true,
  schema: z.object({
    level: z.enum(['info', 'warn', 'error']).optional(),
    jobId: z.string().uuid().optional().describe('collection_jobs.id'),
    sinceMinutes: z.number().int().min(1).max(10080).optional().describe('只看最近 N 分钟'),
    limit: z.number().int().min(1).max(50).default(30),
  }),
  execute: async (args) => {
    const conditions = [];
    if (args.level) conditions.push(eq(t.collectionLogs.level, args.level));
    if (args.jobId) conditions.push(eq(t.collectionLogs.jobId, args.jobId));
    if (args.sinceMinutes) {
      conditions.push(gte(t.collectionLogs.createdAt, new Date(Date.now() - args.sinceMinutes * 60_000)));
    }

    const rows = await db
      .select({
        level: t.collectionLogs.level,
        message: t.collectionLogs.message,
        context: t.collectionLogs.context,
        jobId: t.collectionLogs.jobId,
        createdAt: t.collectionLogs.createdAt,
      })
      .from(t.collectionLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(t.collectionLogs.createdAt))
      .limit(args.limit);

    return { count: rows.length, logs: rows };
  },
});

const getSettings = defineTool({
  name: 'get_settings',
  label: '读取采集配置',
  description: '读取当前的存储策略、每日/每周调度计划与号池策略配置。',
  readOnly: true,
  schema: z.object({}),
  execute: async () => {
    const [storage, dailySchedule, weeklySchedule, pool] = await Promise.all([
      getStorageStrategyConfig(),
      getScheduleConfig('daily'),
      getScheduleConfig('weekly'),
      getPoolConfig(TARGET_SITE),
    ]);
    return { storage, dailySchedule, weeklySchedule, pool };
  },
});

// --------------------------------------------------------------------------
// 写工具：任务
// --------------------------------------------------------------------------

const createTasks = defineTool({
  name: 'create_tasks',
  label: '新增采集任务',
  description: [
    '批量创建采集任务并入队。',
    'list_crawl 抓列表页，用 pages 或 pageFrom+pageTo 指定页码；',
    'detail_fetch 抓视频详情、play_url_refresh 刷新播放地址，都用 externalIds 指定外部视频 ID。',
    `单次最多创建 ${MAX_TASKS_PER_CALL} 个任务。`,
  ].join(''),
  readOnly: false,
  schema: z
    .object({
      type: z.enum(['list_crawl', 'detail_fetch', 'play_url_refresh']),
      kind: z.enum(['gv', 'mv', 'tv']).default('gv'),
      pages: z.array(z.number().int().min(1)).max(MAX_TASKS_PER_CALL).optional(),
      pageFrom: z.number().int().min(1).optional(),
      pageTo: z.number().int().min(1).optional(),
      externalIds: z.array(z.number().int()).max(MAX_TASKS_PER_CALL).optional(),
      priority: z.number().int().min(0).max(1000).default(200),
    })
    .describe('创建采集任务的参数'),
  execute: async (args) => {
    const created: { taskId: string; collectionJobId: string }[] = [];

    if (args.type === 'list_crawl') {
      const pages = new Set<number>(args.pages ?? []);
      if (args.pageFrom !== undefined) {
        const to = args.pageTo ?? args.pageFrom;
        if (to < args.pageFrom) throw new Error('pageTo 不能小于 pageFrom');
        for (let p = args.pageFrom; p <= to; p += 1) pages.add(p);
      }
      if (pages.size === 0) pages.add(1);
      if (pages.size > MAX_TASKS_PER_CALL) {
        throw new Error(`一次最多创建 ${MAX_TASKS_PER_CALL} 个任务，请分批`);
      }

      for (const page of [...pages].sort((a, b) => a - b)) {
        const result = await enqueueCollectionJob({
          taskId: `ai_${args.kind}_page_${page}_${Date.now()}`,
          type: 'list_crawl',
          payload: { targetSite: TARGET_SITE, kind: args.kind, page },
          priority: args.priority,
        });
        created.push({ taskId: `ai_${args.kind}_page_${page}`, collectionJobId: result.collectionJobId });
      }
      return { created: created.length, tasks: created };
    }

    const externalIds = args.externalIds ?? [];
    if (externalIds.length === 0) throw new Error(`${args.type} 需要提供 externalIds`);
    if (externalIds.length > MAX_TASKS_PER_CALL) {
      throw new Error(`一次最多创建 ${MAX_TASKS_PER_CALL} 个任务，请分批`);
    }

    for (const externalId of externalIds) {
      const payload =
        args.type === 'detail_fetch'
          ? { targetSite: TARGET_SITE, kind: args.kind, externalId }
          : { targetSite: TARGET_SITE, externalId };
      const taskId = `ai_${args.type}_${externalId}_${Date.now()}`;
      const result = await enqueueCollectionJob({
        taskId,
        type: args.type as CollectionJobType,
        payload,
        priority: args.priority,
      });
      created.push({ taskId, collectionJobId: result.collectionJobId });
    }

    return { created: created.length, tasks: created };
  },
});

const retryTasks = defineTool({
  name: 'retry_tasks',
  label: '重试失败任务',
  description:
    '重新入队失败的任务。给 jobIds 精确重试；或者 allFailed=true 一次性重试所有失败任务（受 limit 限制）。',
  readOnly: false,
  schema: z.object({
    jobIds: z.array(z.string().uuid()).max(MAX_TASKS_PER_CALL).optional(),
    allFailed: z.boolean().default(false),
    limit: z.number().int().min(1).max(MAX_TASKS_PER_CALL).default(20),
  }),
  execute: async (args) => {
    let jobs;
    if (args.jobIds?.length) {
      jobs = await db.select().from(t.collectionJobs).where(inArray(t.collectionJobs.id, args.jobIds));
    } else if (args.allFailed) {
      jobs = await db
        .select()
        .from(t.collectionJobs)
        .where(and(eq(t.collectionJobs.targetSite, TARGET_SITE), eq(t.collectionJobs.status, 'failed')))
        .orderBy(desc(t.collectionJobs.createdAt))
        .limit(args.limit);
    } else {
      throw new Error('请提供 jobIds，或把 allFailed 设为 true');
    }

    const retried: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const job of jobs) {
      if (job.status !== 'failed') {
        skipped.push({ id: job.id, reason: `当前状态是 ${job.status}，只有 failed 可重试` });
        continue;
      }
      await enqueueCollectionJob({
        taskId: `${job.taskId}_retry_${Date.now()}`,
        type: job.type as CollectionJobType,
        payload: job.payload,
        priority: 300,
      });
      retried.push(job.id);
    }

    return { retried: retried.length, retriedIds: retried, skipped };
  },
});

const updateTask = defineTool({
  name: 'update_task',
  label: '修改采集任务',
  description:
    '修改一个尚未完成的任务：调整优先级或改抓取参数（page / externalId / kind）。实现方式是把旧任务从队列摘掉，再按新参数重新入队。',
  readOnly: false,
  schema: z.object({
    jobId: z.string().uuid().describe('collection_jobs.id'),
    priority: z.number().int().min(0).max(1000).optional(),
    page: z.number().int().min(1).optional(),
    externalId: z.number().int().optional(),
    kind: z.enum(['gv', 'mv', 'tv']).optional(),
  }),
  execute: async (args) => {
    const [job] = await db
      .select()
      .from(t.collectionJobs)
      .where(eq(t.collectionJobs.id, args.jobId))
      .limit(1);
    if (!job) throw new Error('任务不存在');
    if (job.status === 'running') throw new Error('任务正在执行中，等它跑完或失败后再改');

    await removeQueuedJob(job.taskId);

    const payload = { ...job.payload };
    if (args.page !== undefined) payload.page = args.page;
    if (args.externalId !== undefined) payload.externalId = args.externalId;
    if (args.kind !== undefined) payload.kind = args.kind;

    const result = await enqueueCollectionJob({
      taskId: `${job.taskId}_edit_${Date.now()}`,
      type: job.type as CollectionJobType,
      payload,
      priority: args.priority ?? job.priority,
    });

    return { replacedJobId: job.id, newCollectionJobId: result.collectionJobId, payload };
  },
});

const cancelTask = defineTool({
  name: 'cancel_task',
  label: '取消采集任务',
  description: '把还在排队的任务从 BullMQ 队列里摘掉，并把记录标记为失败（错误信息写明是人工取消）。',
  readOnly: false,
  schema: z.object({ jobId: z.string().uuid() }),
  execute: async (args) => {
    const [job] = await db
      .select()
      .from(t.collectionJobs)
      .where(eq(t.collectionJobs.id, args.jobId))
      .limit(1);
    if (!job) throw new Error('任务不存在');
    if (job.status === 'completed') throw new Error('任务已完成，无需取消');

    const removed = await removeQueuedJob(job.taskId);
    await db
      .update(t.collectionJobs)
      .set({
        status: 'failed',
        errorMessage: '已由 AI 维护取消',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(t.collectionJobs.id, job.id));

    return { jobId: job.id, removedFromQueue: removed };
  },
});

/** 队列里可能已经没这个 job（跑完清理掉了），摘不到不算错误 */
async function removeQueuedJob(taskId: string): Promise<boolean> {
  try {
    const queued = await getCollectionQueue().getJob(taskId);
    if (!queued) return false;
    await queued.remove();
    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// 写工具：号池
// --------------------------------------------------------------------------

const addAccounts = defineTool({
  name: 'add_accounts',
  label: '新增号池账号',
  description: '往号池里批量添加目标站账号。管理员在对话里贴出新的 uid/token 时用这个入库。',
  readOnly: false,
  schema: z.object({
    accounts: z
      .array(
        z.object({
          uid: z.string().min(1).max(64),
          token: z.string().min(8).max(256),
          username: z.string().max(64).optional(),
          isVip: z.boolean().default(false),
          vipExpiresAt: z.string().optional().describe('ISO 时间字符串'),
        }),
      )
      .min(1)
      .max(20),
  }),
  execute: async (args) => {
    const manager = AccountPoolManager.getInstance();
    const ids: string[] = [];
    for (const acc of args.accounts) {
      ids.push(
        await manager.addAccount({
          targetSite: TARGET_SITE,
          uid: acc.uid,
          token: acc.token,
          username: acc.username,
          isVip: acc.isVip,
          vipExpiresAt: acc.vipExpiresAt,
        }),
      );
    }
    return { added: ids.length, ids };
  },
});

const updateAccount = defineTool({
  name: 'update_account',
  label: '更新号池账号',
  description:
    '更新单个账号：换动态 token、改状态（active/inactive/banned）、改 VIP 标记或用户名。可以用 accountId 或目标站 uid 定位。',
  readOnly: false,
  schema: z
    .object({
      accountId: z.string().uuid().optional().describe('account_pools.id'),
      uid: z.string().max(64).optional().describe('目标站 uid，与 accountId 二选一'),
      token: z.string().min(8).max(256).optional().describe('新的动态 token'),
      status: z.enum(['active', 'inactive', 'banned']).optional(),
      isVip: z.boolean().optional(),
      username: z.string().max(64).optional(),
    })
    .describe('accountId 与 uid 至少给一个'),
  execute: async (args) => {
    const locator = args.accountId
      ? eq(t.accountPools.id, args.accountId)
      : args.uid
        ? and(eq(t.accountPools.targetSite, TARGET_SITE), eq(t.accountPools.uid, args.uid))
        : null;
    if (!locator) throw new Error('请提供 accountId 或 uid');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (args.token !== undefined) patch.token = args.token;
    if (args.status !== undefined) patch.status = args.status;
    if (args.isVip !== undefined) patch.isVip = args.isVip;
    if (args.username !== undefined) patch.username = args.username;
    if (Object.keys(patch).length === 1) throw new Error('没有要更新的字段');

    const [updated] = await db.update(t.accountPools).set(patch).where(locator).returning();
    if (!updated) throw new Error('账号不存在');

    return {
      id: updated.id,
      uid: updated.uid,
      status: updated.status,
      isVip: updated.isVip,
      token: maskToken(updated.token),
    };
  },
});

const deleteAccount = defineTool({
  name: 'delete_account',
  label: '删除号池账号',
  description: '从号池中彻底删除一个账号。确认已经作废时才用，通常优先改成 inactive。',
  readOnly: false,
  schema: z.object({ accountId: z.string().uuid() }),
  execute: async (args) => {
    const manager = AccountPoolManager.getInstance();
    const account = await manager.getAccountById(args.accountId);
    if (!account) throw new Error('账号不存在');
    await manager.deleteAccount(args.accountId);
    return { deleted: true, uid: account.uid };
  },
});

const healthCheckAccounts = defineTool({
  name: 'health_check_accounts',
  label: '账号健康检查',
  description:
    '用目标站接口验证 token 是否还有效，失效的账号会被自动标记。不传 accountId 就全量检查整个号池。',
  readOnly: false,
  schema: z.object({ accountId: z.string().uuid().optional() }),
  execute: async (args) => {
    const manager = AccountPoolManager.getInstance();
    if (args.accountId) {
      const valid = await manager.healthCheckAccount(args.accountId);
      return { accountId: args.accountId, valid };
    }
    return await manager.healthCheckAll(TARGET_SITE);
  },
});

// --------------------------------------------------------------------------
// 写工具：入库与发布
// --------------------------------------------------------------------------

const importVideos = defineTool({
  name: 'import_videos',
  label: '采集视频入库',
  description: [
    '把 collected_videos 里的记录导入正式视频库。',
    '给 collectedVideoIds 精确导入；不给就按 pendingLimit 自动挑最新的待导入记录。',
    'autoPublish=true 时导入后直接公开发布。',
  ].join(''),
  readOnly: false,
  schema: z.object({
    collectedVideoIds: z.array(z.string().uuid()).max(MAX_IMPORT_PER_CALL).optional(),
    pendingLimit: z
      .number()
      .int()
      .min(1)
      .max(MAX_IMPORT_PER_CALL)
      .optional()
      .describe('不给 collectedVideoIds 时，自动挑这么多条待导入记录'),
    kind: z.enum(['gv', 'mv', 'tv']).optional().describe('自动挑选时限定类型'),
    autoPublish: z.boolean().default(true),
    forceMode: z.enum(['hotlink', 'r2_transfer']).optional().describe('强制指定存储方式，默认按策略自动决定'),
  }),
  execute: async (args, ctx) => {
    let ids = args.collectedVideoIds ?? [];

    if (ids.length === 0) {
      const conditions = [
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        eq(t.collectedVideos.status, 'pending'),
      ];
      if (args.kind) conditions.push(eq(t.collectedVideos.kind, args.kind));
      const rows = await db
        .select({ id: t.collectedVideos.id })
        .from(t.collectedVideos)
        .where(and(...conditions))
        .orderBy(desc(t.collectedVideos.createdAt))
        .limit(args.pendingLimit ?? 10);
      ids = rows.map((row) => row.id);
    }

    if (ids.length === 0) return { imported: 0, failed: 0, note: '没有待导入的采集记录' };

    const result = await batchFromExternalImport({
      collectedVideoIds: ids,
      userId: ctx.userId,
      autoPublish: args.autoPublish,
      forceMode: args.forceMode,
    });

    return {
      imported: result.imported.length,
      failed: result.failed.length,
      importedItems: result.imported,
      failedItems: result.failed,
    };
  },
});

const setVideoPublished = defineTool({
  name: 'set_video_published',
  label: '发布/下架采集视频',
  description: '把已导入的采集视频批量设为公开发布，或者下架归档。',
  readOnly: false,
  schema: z.object({
    collectedVideoIds: z.array(z.string().uuid()).min(1).max(MAX_IMPORT_PER_CALL),
    published: z.boolean().describe('true 发布，false 下架归档'),
  }),
  execute: async (args) => {
    const done: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of args.collectedVideoIds) {
      try {
        if (args.published) {
          const [collected] = await db
            .select()
            .from(t.collectedVideos)
            .where(eq(t.collectedVideos.id, id))
            .limit(1);
          if (!collected) throw new Error('采集记录不存在');
          if (!collected.videoId) throw new Error('尚未导入，请先调用 import_videos');
          await db
            .update(t.videos)
            .set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() })
            .where(eq(t.videos.id, collected.videoId));
        } else {
          await unpublishCollectedVideo(id);
        }
        done.push(id);
      } catch (error) {
        failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { action: args.published ? 'publish' : 'unpublish', succeeded: done.length, failed };
  },
});

// --------------------------------------------------------------------------
// 写工具：配置
// --------------------------------------------------------------------------

const updateSettings = defineTool({
  name: 'update_settings',
  label: '修改采集配置',
  description:
    '增量修改采集配置：存储策略 storage、每日调度 dailySchedule、每周调度 weeklySchedule、号池策略 pool。只传要改的字段。',
  readOnly: false,
  schema: collectionSettingsPatchSchema,
  execute: async (args) => {
    if (args.storage) await setStorageStrategyConfig(args.storage);
    if (args.dailySchedule) await setScheduleConfig('daily', args.dailySchedule);
    if (args.weeklySchedule) await setScheduleConfig('weekly', args.weeklySchedule);
    if (args.pool) await setPoolConfig(TARGET_SITE, args.pool);

    const [storage, dailySchedule, weeklySchedule, pool] = await Promise.all([
      getStorageStrategyConfig(),
      getScheduleConfig('daily'),
      getScheduleConfig('weekly'),
      getPoolConfig(TARGET_SITE),
    ]);
    return { storage, dailySchedule, weeklySchedule, pool };
  },
});

// --------------------------------------------------------------------------
// 注册表
// --------------------------------------------------------------------------

export const AI_TOOLS: AiTool[] = [
  getOverview,
  getQueueStatus,
  listTasks,
  listAccounts,
  listCollectedVideos,
  getLogs,
  getSettings,
  createTasks,
  retryTasks,
  updateTask,
  cancelTask,
  addAccounts,
  updateAccount,
  deleteAccount,
  healthCheckAccounts,
  importVideos,
  setVideoPublished,
  updateSettings,
];

const TOOL_BY_NAME = new Map(AI_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): AiTool | undefined {
  return TOOL_BY_NAME.get(name);
}

/** 把 zod schema 转成模型能读的 JSON Schema。$schema 字段各家网关兼容性不一，去掉。 */
export function toolDefinitions(): LlmToolDefinition[] {
  return AI_TOOLS.map((tool) => {
    const parameters = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>;
    delete parameters.$schema;
    return {
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters },
    };
  });
}

/** 给前端展示「这个助手能干什么」 */
export function toolCatalog(): { name: string; label: string; readOnly: boolean; description: string }[] {
  return AI_TOOLS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    readOnly: tool.readOnly,
    description: tool.description,
  }));
}
