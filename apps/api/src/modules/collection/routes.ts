// ========================================================================
// 采集系统 - REST API Routes
// 挂载于 /api/collection（见 app.ts）
// ========================================================================

import { Router } from 'express';
import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { body, validate } from '../../middleware/validate.js';
import { logger } from '../../core/logger.js';
import { audit } from '../admin/audit.js';
import { collectionAiRouter } from './ai/routes.js';
import { AccountPoolManager } from './pool-manager.js';
import { collectionSettingsPatchSchema } from './settings-schema.js';
import {
  enqueueCollectionJob,
  getQueueStats,
  type CollectionJobType,
} from './queues/tasks.js';
import {
  getCollectionConfig,
  setCollectionConfig,
  getStorageStrategyConfig,
  setStorageStrategyConfig,
  getScheduleConfig,
  setScheduleConfig,
  getPoolConfig,
  setPoolConfig,
} from './storage/config.js';
import { getPendingImportVideos, getCollectedVideoByExternalId } from './storage/ingestor.js';
import {
  fromExternalImport,
  batchFromExternalImport,
  unpublishCollectedVideo,
} from './storage/import.js';

export const collectionRouter: Router = Router();

// 全部接口要求管理员权限
collectionRouter.use(requireAuth, requireAdmin);

// AI 维护（接口配置 / 会话 / 工具调用确认）
collectionRouter.use('/ai', collectionAiRouter);

const TARGET_SITE = 'yitongkan';

// --------------------------------------------------------------------------
// Zod Schema
// --------------------------------------------------------------------------

const addAccountSchema = z.object({
  uid: z.string().min(1).max(64),
  token: z.string().min(8).max(256),
  username: z.string().max(64).optional(),
  isVip: z.boolean().default(false),
  vipExpiresAt: z.string().datetime().optional().nullable(),
});

const bulkImportSchema = z.object({
  accounts: z.array(addAccountSchema).min(1),
});

const updateAccountSchema = z.object({
  status: z.enum(['active', 'inactive', 'banned']).optional(),
  username: z.string().max(64).optional().nullable(),
  token: z.string().min(8).max(256).optional(),
  isVip: z.boolean().optional(),
});

const createTaskSchema = z.object({
  type: z.enum(['list_crawl', 'detail_fetch', 'play_url_refresh']),
  kind: z.enum(['gv', 'mv', 'tv']).default('gv'),
  page: z.number().int().min(1).default(1),
  externalId: z.number().int().optional(),
  priority: z.number().int().min(0).max(1000).default(100),
});

const importVideoSchema = z.object({
  collectedVideoIds: z.array(z.string().uuid()).min(1),
  autoPublish: z.boolean().default(true),
  forceMode: z.enum(['hotlink', 'r2_transfer']).optional(),
  accessLevel: z.enum(['free', 'login', 'vip']).default('vip'),
  categoryId: z.string().uuid().optional().nullable(),
});

const updateSettingsSchema = collectionSettingsPatchSchema;

// ==========================================================================
// 号池管理
// ==========================================================================

/** POST /pools - 批量导入账号 */
collectionRouter.post(
  '/pools',
  validate({ body: bulkImportSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof bulkImportSchema>>(req);
    const manager = AccountPoolManager.getInstance();
    const ids: string[] = [];

    for (const acc of input.accounts) {
      ids.push(
        await manager.addAccount({
          targetSite: TARGET_SITE,
          uid: acc.uid,
          token: acc.token,
          username: acc.username,
          isVip: acc.isVip,
          vipExpiresAt: acc.vipExpiresAt ?? undefined,
        }),
      );
    }

    await audit(req, 'collection.pools.import', undefined, { count: ids.length });
    ok(res, { ids }, `成功导入 ${ids.length} 个账号`);
  }),
);

/** GET /pools - 账号列表（分页 + 筛选） */
collectionRouter.get(
  '/pools',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = (req.query.status as string | undefined) ?? undefined;
    const isVip =
      req.query.isVip === 'true' ? true : req.query.isVip === 'false' ? false : undefined;
    const search = (req.query.search as string | undefined)?.trim() || undefined;

    const manager = AccountPoolManager.getInstance();
    const result = await manager.getList(TARGET_SITE, page, pageSize, {
      status: status as 'active' | 'inactive' | 'banned' | undefined,
      isVip,
      search,
    });

    // token 是敏感信息，列表只回显前 8 位
    const items = result.items.map((acc) => ({
      ...acc,
      token: `${acc.token.slice(0, 8)}…`,
    }));

    ok(res, paginated(items, result.total, page, pageSize));
  }),
);

/** PUT /pools/:id - 更新账号 */
collectionRouter.put(
  '/pools/:id',
  validate({ body: updateAccountSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = body<z.infer<typeof updateAccountSchema>>(req);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.username !== undefined) patch.username = input.username;
    if (input.token !== undefined) patch.token = input.token;
    if (input.isVip !== undefined) patch.isVip = input.isVip;

    const [updated] = await db
      .update(t.accountPools)
      .set(patch)
      .where(eq(t.accountPools.id, id))
      .returning();

    if (!updated) throw AppError.notFound('账号不存在');
    await audit(req, 'collection.pools.update', { type: 'account', id });

    ok(res, { ...updated, token: `${updated.token.slice(0, 8)}…` }, '更新成功');
  }),
);

/** DELETE /pools/:id - 删除账号 */
collectionRouter.delete(
  '/pools/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const manager = AccountPoolManager.getInstance();
    const account = await manager.getAccountById(id);
    if (!account) throw AppError.notFound('账号不存在');

    await manager.deleteAccount(id);
    await audit(req, 'collection.pools.delete', { type: 'account', id });

    ok(res, null, '删除成功');
  }),
);

/** POST /pools/health-check - 触发批量健康检查 */
collectionRouter.post(
  '/pools/health-check',
  asyncHandler(async (req, res) => {
    const manager = AccountPoolManager.getInstance();

    const singleId = typeof req.body?.accountId === 'string' ? req.body.accountId : null;
    if (singleId) {
      const valid = await manager.healthCheckAccount(singleId);
      await audit(req, 'collection.pools.healthCheck', { type: 'account', id: singleId });
      ok(res, { valid }, valid ? '账号有效' : '账号已失效');
      return;
    }

    const result = await manager.healthCheckAll(TARGET_SITE);
    await audit(req, 'collection.pools.healthCheckAll', undefined, result);
    ok(res, result, `健康检查完成：${result.valid} 有效 / ${result.invalid} 失效 / ${result.failed} 检查失败`);
  }),
);

/** GET /pools/stats - 号池统计 */
collectionRouter.get(
  '/pools/stats',
  asyncHandler(async (_req, res) => {
    const manager = AccountPoolManager.getInstance();
    const stats = await manager.getStats(TARGET_SITE);
    ok(res, stats);
  }),
);

// ==========================================================================
// 任务管理（collection_jobs 持久化记录 + BullMQ 实时状态）
// ==========================================================================

/** GET /tasks - 任务列表 */
collectionRouter.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = (req.query.status as string | undefined) ?? undefined;
    const type = (req.query.type as string | undefined) ?? undefined;

    const conditions = [eq(t.collectionJobs.targetSite, TARGET_SITE)];
    if (status) conditions.push(eq(t.collectionJobs.status, status));
    if (type) conditions.push(eq(t.collectionJobs.type, type));
    const where = and(...conditions);

    const [countRows, items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.collectionJobs)
        .where(where),
      db
        .select()
        .from(t.collectionJobs)
        .where(where)
        .orderBy(desc(t.collectionJobs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), page, pageSize));
  }),
);

/** GET /tasks/queue-stats - BullMQ 队列实时状态 */
collectionRouter.get(
  '/tasks/queue-stats',
  asyncHandler(async (_req, res) => {
    try {
      const stats = await getQueueStats();
      ok(res, stats);
    } catch {
      // Redis 未就绪时不影响面板打开
      ok(res, { waiting: 0, active: 0, failed: 0 });
    }
  }),
);

/** POST /tasks - 手动创建任务 */
collectionRouter.post(
  '/tasks',
  validate({ body: createTaskSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof createTaskSchema>>(req);

    let taskId: string;
    let payload: Record<string, unknown>;
    if (input.type === 'list_crawl') {
      taskId = `manual_${input.kind}_page_${input.page}_${Date.now()}`;
      payload = { targetSite: TARGET_SITE, kind: input.kind, page: input.page };
    } else if (input.type === 'detail_fetch') {
      if (!input.externalId) throw AppError.badRequest('detail_fetch 需要 externalId');
      taskId = `manual_${input.kind}_detail_${input.externalId}_${Date.now()}`;
      payload = { targetSite: TARGET_SITE, kind: input.kind, externalId: input.externalId };
    } else {
      if (!input.externalId) throw AppError.badRequest('play_url_refresh 需要 externalId');
      taskId = `manual_refresh_${input.externalId}_${Date.now()}`;
      payload = { targetSite: TARGET_SITE, externalId: input.externalId };
    }

    const result = await enqueueCollectionJob({
      taskId,
      type: input.type as CollectionJobType,
      payload,
      priority: input.priority,
    });

    await audit(req, 'collection.tasks.create', undefined, { taskId, type: input.type });
    ok(res, result, '任务已创建');
  }),
);

/** POST /tasks/:id/retry - 重试失败任务 */
collectionRouter.post(
  '/tasks/:id/retry',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [job] = await db
      .select()
      .from(t.collectionJobs)
      .where(eq(t.collectionJobs.id, id))
      .limit(1);

    if (!job) throw AppError.notFound('任务不存在');
    if (job.status !== 'failed') throw AppError.badRequest('只有失败的任务可以重试');

    const result = await enqueueCollectionJob({
      taskId: `${job.taskId}_retry_${Date.now()}`,
      type: job.type as CollectionJobType,
      payload: job.payload,
      priority: 200,
    });

    await audit(req, 'collection.tasks.retry', { type: 'collectionJob', id });
    ok(res, result, '重试任务已入队');
  }),
);

// ==========================================================================
// 采集视频管理（collected_videos）
// ==========================================================================

/** GET /videos - 采集视频列表 */
collectionRouter.get(
  '/videos',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = (req.query.status as string | undefined) ?? undefined;
    const kind = (req.query.kind as string | undefined) ?? undefined;
    const search = (req.query.search as string | undefined)?.trim() || undefined;

    const conditions = [eq(t.collectedVideos.targetSite, TARGET_SITE)];
    if (status) conditions.push(eq(t.collectedVideos.status, status));
    if (kind) conditions.push(eq(t.collectedVideos.kind, kind));
    if (search) {
      conditions.push(or(ilike(t.collectedVideos.title, `%${search}%`))!);
    }
    const where = and(...conditions);

    const [countRows, items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.collectedVideos)
        .where(where),
      db
        .select()
        .from(t.collectedVideos)
        .where(where)
        .orderBy(desc(t.collectedVideos.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), page, pageSize));
  }),
);

/** GET /videos/pending-count - 待导入数量（徽标用） */
collectionRouter.get(
  '/videos/pending-count',
  asyncHandler(async (_req, res) => {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.collectedVideos)
      .where(and(eq(t.collectedVideos.targetSite, TARGET_SITE), eq(t.collectedVideos.status, 'pending')));
    ok(res, { count: Number(row?.total ?? 0) });
  }),
);

/** POST /videos/import - 批量导入到 videos 表并发布 */
collectionRouter.post(
  '/videos/import',
  validate({ body: importVideoSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof importVideoSchema>>(req);
    const userId = req.auth!.id;

    const result = await batchFromExternalImport({
      collectedVideoIds: input.collectedVideoIds,
      userId,
      autoPublish: input.autoPublish,
      forceMode: input.forceMode,
      categoryId: input.categoryId,
    });

    await audit(req, 'collection.videos.import', undefined, {
      imported: result.imported.length,
      failed: result.failed.length,
    });

    ok(res, result, `导入完成：${result.imported.length} 成功 / ${result.failed.length} 失败`);
  }),
);

/** POST /videos/:id/publish - 发布已导入（unlisted）的视频 */
collectionRouter.post(
  '/videos/:id/publish',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [collected] = await db
      .select()
      .from(t.collectedVideos)
      .where(eq(t.collectedVideos.id, id))
      .limit(1);

    if (!collected) throw AppError.notFound('采集视频记录不存在');
    if (!collected.videoId) throw AppError.badRequest('该视频尚未导入，请先导入');

    await db
      .update(t.videos)
      .set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(t.videos.id, collected.videoId));

    await audit(req, 'collection.videos.publish', { type: 'collectedVideo', id });
    ok(res, null, '视频已发布');
  }),
);

/** POST /videos/:id/unpublish - 下架并归档 */
collectionRouter.post(
  '/videos/:id/unpublish',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    await unpublishCollectedVideo(id);
    await audit(req, 'collection.videos.unpublish', { type: 'collectedVideo', id });
    ok(res, null, '视频已下架归档');
  }),
);

/** GET /videos/:id - 采集视频详情 */
collectionRouter.get(
  '/videos/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [collected] = await db
      .select()
      .from(t.collectedVideos)
      .where(eq(t.collectedVideos.id, id))
      .limit(1);

    if (!collected) throw AppError.notFound('采集视频记录不存在');
    ok(res, collected);
  }),
);

// ==========================================================================
// 日志查询
// ==========================================================================

/** GET /logs - 采集日志（分页 + 按级别/任务过滤） */
collectionRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const level = (req.query.level as string | undefined) ?? undefined;
    const jobId = (req.query.jobId as string | undefined) ?? undefined;
    const since = (req.query.since as string | undefined) ?? undefined;

    const conditions = [];
    if (level) conditions.push(eq(t.collectionLogs.level, level));
    if (jobId) conditions.push(eq(t.collectionLogs.jobId, jobId));
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        conditions.push(gte(t.collectionLogs.createdAt, sinceDate));
      }
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRows, items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.collectionLogs)
        .where(where),
      db
        .select()
        .from(t.collectionLogs)
        .where(where)
        .orderBy(desc(t.collectionLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), page, pageSize));
  }),
);

// ==========================================================================
// 配置管理
// ==========================================================================

/** GET /settings - 读取全部采集配置 */
collectionRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const [storage, daily, weekly, pool] = await Promise.all([
      getStorageStrategyConfig(),
      getScheduleConfig('daily'),
      getScheduleConfig('weekly'),
      getPoolConfig(TARGET_SITE),
    ]);
    ok(res, { storage, dailySchedule: daily, weeklySchedule: weekly, pool });
  }),
);

/** PUT /settings - 更新采集配置 */
collectionRouter.put(
  '/settings',
  validate({ body: updateSettingsSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof updateSettingsSchema>>(req);

    if (input.storage) await setStorageStrategyConfig(input.storage);
    if (input.dailySchedule) await setScheduleConfig('daily', input.dailySchedule);
    if (input.weeklySchedule) await setScheduleConfig('weekly', input.weeklySchedule);
    if (input.pool) await setPoolConfig(TARGET_SITE, input.pool);

    await audit(req, 'collection.settings.update', undefined, input);
    ok(res, null, '配置已保存');
  }),
);

// ==========================================================================
// Dashboard 统计
// ==========================================================================

/** GET /stats - 数据概览（Dashboard 首屏） */
collectionRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [poolManager, taskToday, taskStats, videoStats, queueRealtime] = await Promise.all([
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
          hotlink: sql<number>`sum(CASE WHEN ${t.collectedVideos.importMode} = 'hotlink' THEN 1 ELSE 0 END)::int`,
          r2: sql<number>`sum(CASE WHEN ${t.collectedVideos.importMode} = 'r2_transfer' THEN 1 ELSE 0 END)::int`,
          todayNew: sql<number>`sum(CASE WHEN ${t.collectedVideos.createdAt} >= ${todayStart.toISOString()} THEN 1 ELSE 0 END)::int`,
        })
        .from(t.collectedVideos)
        .where(eq(t.collectedVideos.targetSite, TARGET_SITE)),
      getQueueStats().catch(() => ({ waiting: 0, active: 0, failed: 0 })),
    ]);

    ok(res, {
      pool: poolManager,
      todayTasks: taskToday[0] ?? { total: 0, completed: 0, failed: 0, running: 0, queued: 0 },
      allTasks: taskStats[0] ?? { total: 0, completed: 0, failed: 0 },
      videos: videoStats[0] ?? { total: 0, pending: 0, imported: 0, hotlink: 0, r2: 0, todayNew: 0 },
      queue: queueRealtime,
    });
  }),
);

/** GET /stats/trend - 每日采集趋势（近 N 天） */
collectionRouter.get(
  '/stats/trend',
  asyncHandler(async (req, res) => {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        date: sql<string>`to_char(${t.collectedVideos.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(t.collectedVideos)
      .where(
        and(
          eq(t.collectedVideos.targetSite, TARGET_SITE),
          gte(t.collectedVideos.createdAt, since),
        ),
      )
      .groupBy(sql`to_char(${t.collectedVideos.createdAt}::date, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${t.collectedVideos.createdAt}::date, 'YYYY-MM-DD')`);

    ok(res, rows);
  }),
);

// ==========================================================================
// 调试工具
// ==========================================================================

/** GET /debug/external/:externalId - 按外部 ID 查询采集记录（诊断用） */
collectionRouter.get(
  '/debug/external/:externalId',
  asyncHandler(async (req, res) => {
    const record = await getCollectedVideoByExternalId(req.params.externalId!, TARGET_SITE);
    if (!record) throw AppError.notFound('未找到对应采集记录');
    ok(res, record);
  }),
);

/** 保留：待导入视频快速查询（大列表导入场景） */
export { getPendingImportVideos, getCollectionConfig, setCollectionConfig, fromExternalImport };

/** 兼容 logger 引用（诊断接口静默使用） */
void logger;
