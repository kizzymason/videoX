// ========================================================================
// 采集系统 - Worker 任务处理器
// 消费 BullMQ collection 队列，任务状态回写 collection_jobs 表
// ========================================================================

import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { db, t } from '@videox/api/core/db';
import {
  AccountPoolManager,
  createClientFromAccount,
  enqueueCollectionJob,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  markJobRetry,
  upsertCollectedVideo,
  R2TransferService,
  type AccountPoolEntry,
  type CollectionJobData,
  type DetailFetchJobData,
  type ListCrawlJobData,
  type PlayUrlRefreshJobData,
  type R2TransferJobData,
} from '@videox/api/collection';
import { fullCrawlBatchIndex, nextFullCrawlDelayMs, planFullCrawl } from '@videox/shared';
import { logger } from '../logger.js';

/** 采集任务并发入口（由 index.ts 注册到 Worker） */
export async function runCollectionJob(job: Job<CollectionJobData>): Promise<void> {
  const started = Date.now();
  // discriminant：job.name 即任务类型（入队时以 type 作为 name）
  const type = job.name as 'list_crawl' | 'detail_fetch' | 'play_url_refresh' | 'r2_transfer';
  const collectionJobId = (job.data as { collectionJobId?: string }).collectionJobId;

  logger.info({ bullmqJobId: job.id, type, collectionJobId }, '开始处理采集任务');

  if (collectionJobId) {
    // BullMQ 自动重试：attemptsLeft 反推第几次尝试
    const attempt = job.attemptsMade + 1;
    if (attempt > 1) {
      await markJobRetry(collectionJobId, attempt - 1).catch(() => undefined);
    }
    await markJobRunning(collectionJobId).catch(() => undefined);
  }

  try {
    switch (type) {
      case 'list_crawl':
        await crawlListJob(job as Job<ListCrawlJobData>);
        break;
      case 'detail_fetch':
        await fetchDetailJob(job as Job<DetailFetchJobData>);
        break;
      case 'play_url_refresh':
        await refreshPlayUrlJob(job as Job<PlayUrlRefreshJobData>);
        break;
      case 'r2_transfer':
        await r2TransferJob(job as Job<R2TransferJobData>);
        break;
      default:
        throw new Error(`未知的任务类型：${type}`);
    }

    if (collectionJobId) await markJobCompleted(collectionJobId).catch(() => undefined);
    logger.info({ bullmqJobId: job.id, type, durationMs: Date.now() - started }, '采集任务完成');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // BullMQ 还有重试机会时不标 failed（最后一次失败才标）
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (collectionJobId && isFinalAttempt) {
      await markJobFailed(collectionJobId, message).catch(() => undefined);
    }
    await logCollectionJob(collectionJobId, 'error', `任务失败：${message}`, {
      bullmqJobId: job.id,
      type,
    });
    logger.error({ bullmqJobId: job.id, type, err: error }, '采集任务失败');
    throw error;
  }
}

// --------------------------------------------------------------------------
// 列表爬取
// --------------------------------------------------------------------------

async function crawlListJob(job: Job<ListCrawlJobData>): Promise<void> {
  const { targetSite, kind, page } = job.data;
  const collectionJobId = (job.data as { collectionJobId?: string }).collectionJobId;

  // 1. 号池取账号
  const account = await requireAccount(targetSite);

  // 2. 调源站列表 API
  const client = createClientFromAccount(account);
  const result =
    kind === 'gv'
      ? await client.getGVList(page, 20)
      : kind === 'mv'
        ? await client.getMVList(page, 20)
        : await client.getTVList(page, 20);

  if (result.code !== '200' || !Array.isArray(result.data?.list)) {
    throw new Error(`源站列表 API 异常: ${result.code} ${result.message ?? ''}`);
  }

  // 3. 逐条 upsert 到 collected_videos（newExternalIds 记录新发现的 externalId，供级联详情任务用）
  // 单条写库失败只跳过这一条，不打断同页其余视频和后续翻页。
  const newExternalIds = new Set<string>();
  let newCount = 0;
  let skipped = 0;
  for (const item of result.data.list) {
    try {
      const { isNew } = await upsertCollectedVideo({
        externalId: String(item.id),
        targetSite,
        kind,
        title: item.title,
        metadata: { ...item, fetchedAt: new Date().toISOString() },
        status: 'pending',
        page,
      });
      if (isNew) {
        newExternalIds.add(String(item.id));
        newCount++;
      }
    } catch (error) {
      skipped += 1;
      const message = error instanceof Error ? error.message : String(error);
      await logCollectionJob(
        collectionJobId,
        'warn',
        `跳过无法入库的视频 ${item.id}：${message.slice(0, 180)}`,
        { externalId: item.id, page, kind },
      );
      logger.warn({ externalId: item.id, kind, page, err: error }, '单条采集入库失败，已跳过');
    }
  }

  await logCollectionJob(
    collectionJobId,
    'info',
    `抓取 ${kind.toUpperCase()} 第 ${page} 页：共 ${result.data.list.length} 条，新增 ${newCount} 条${skipped ? `，跳过 ${skipped} 条` : ''}`,
    { page, total: result.data.total, newCount, skipped },
  );

  // 4. 为本页新发现的视频级联生成详情任务（已存在的跳过，避免任务爆炸）
  for (const item of result.data.list) {
    if (!newExternalIds.has(String(item.id))) continue;
    await enqueueCollectionJob({
      taskId: `${targetSite}_${kind}_detail_${item.id}`,
      type: 'detail_fetch',
      payload: { targetSite, kind, externalId: item.id },
      priority: 10,
    });
  }

  // 5. 翻页：每日/每周仍按原逻辑（只在显式带 totalPages 时链式翻页）。
  // 管理员手动全量抓取带 incremental=false：翻到结束页，每批末尾按批次间隔再开下一批。
  if (job.data.incremental === false) {
    const sourcePages = Math.max(1, Math.ceil((result.data.total ?? 0) / 20) || page);
    const plan = planFullCrawl({
      endPage: job.data.endPage ?? job.data.maxPages ?? job.data.totalPages ?? sourcePages,
      pagesPerBatch: job.data.pagesPerBatch,
      batchIntervalSeconds: job.data.batchIntervalSeconds,
    });
    if (result.data.list.length > 0 && page < plan.endPage) {
      const runId = job.data.runId ?? `${targetSite}_${kind}_${Date.now()}`;
      const delayMs = nextFullCrawlDelayMs(page, plan);
      const nextPage = page + 1;
      const nextBatch = fullCrawlBatchIndex(nextPage, plan.pagesPerBatch);
      if (delayMs > 500) {
        await logCollectionJob(
          collectionJobId,
          'info',
          `全量抓取下一批：${kind.toUpperCase()} 第 ${nextPage}/${plan.endPage} 页（第 ${nextBatch}/${plan.batchCount} 批），等待 ${Math.round(delayMs / 1000)} 秒`,
          { nextPage, delayMs, batch: nextBatch, ...plan },
        );
      }
      await enqueueCollectionJob({
        taskId: `${runId}_${kind}_p${nextPage}`,
        type: 'list_crawl',
        payload: {
          targetSite,
          kind,
          page: nextPage,
          incremental: false,
          maxPages: plan.endPage,
          endPage: plan.endPage,
          pagesPerBatch: plan.pagesPerBatch,
          batchIntervalSeconds: plan.batchIntervalSeconds,
          runId,
        },
        priority: 20,
        delayMs,
      });
    } else {
      await logCollectionJob(
        collectionJobId,
        'info',
        `全量抓取本类结束：${kind.toUpperCase()} 第 ${page}/${plan.endPage} 页，本页新增 ${newCount}`,
        { page, newCount, ...plan },
      );
    }
    return;
  }

  const totalPages = job.data.totalPages ?? Math.ceil((result.data.total ?? 0) / 20);
  if (job.data.totalPages && page < totalPages && result.data.list.length > 0) {
    await enqueueCollectionJob({
      taskId: `${targetSite}_${kind}_list_${page + 1}`,
      type: 'list_crawl',
      payload: { targetSite, kind, page: page + 1, totalPages },
      priority: 0,
    });
  }
}

// --------------------------------------------------------------------------
// 详情获取（拉取播放地址与完整元数据）
// --------------------------------------------------------------------------

async function fetchDetailJob(job: Job<DetailFetchJobData>): Promise<void> {
  const { targetSite, kind, externalId } = job.data;
  const collectionJobId = (job.data as { collectionJobId?: string }).collectionJobId;

  const account = await requireAccount(targetSite);
  const client = createClientFromAccount(account);
  const playResult = await client.getPlayUrl(externalId, kind);

  if (playResult.code !== '200' || !playResult.data?.url) {
    throw new Error(`源站 play API 异常: ${playResult.code} ${playResult.message ?? ''}`);
  }

  // 合并进已有 metadata
  const [existing] = await db
    .select()
    .from(t.collectedVideos)
    .where(
      and(
        eq(t.collectedVideos.externalId, String(externalId)),
        eq(t.collectedVideos.targetSite, targetSite),
      ),
    )
    .limit(1);

  if (!existing) {
    logger.warn({ externalId, targetSite }, '详情任务找不到对应采集记录，跳过');
    return;
  }

  await db
    .update(t.collectedVideos)
    .set({
      externalPlayUrl: playResult.data.url,
      metadata: {
        ...(existing.metadata ?? {}),
        playUrl: playResult.data.url,
        qualities: playResult.data.qualities,
        lastFetchedAt: new Date().toISOString(),
      },
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(t.collectedVideos.id, existing.id));

  await logCollectionJob(collectionJobId, 'info', `获取播放地址成功（${kind}/${externalId}）`, {
    externalId,
    qualities: playResult.data.qualities?.length ?? 0,
  });
}

// --------------------------------------------------------------------------
// 播放地址刷新（定期更新失效链接）
// --------------------------------------------------------------------------

async function refreshPlayUrlJob(job: Job<PlayUrlRefreshJobData>): Promise<void> {
  const { targetSite, externalId } = job.data;
  const collectionJobId = (job.data as { collectionJobId?: string }).collectionJobId;

  const [existing] = await db
    .select()
    .from(t.collectedVideos)
    .where(
      and(
        eq(t.collectedVideos.externalId, String(externalId)),
        eq(t.collectedVideos.targetSite, targetSite),
      ),
    )
    .limit(1);

  if (!existing) throw new Error(`未找到外部 ID 为 ${externalId} 的视频`);

  const account = await requireAccount(targetSite);
  const client = createClientFromAccount(account);
  const playResult = await client.getPlayUrl(externalId, existing.kind as 'gv' | 'mv' | 'tv');

  if (playResult.code !== '200' || !playResult.data?.url) {
    throw new Error(`源站 play API 异常: ${playResult.code}`);
  }

  await db
    .update(t.collectedVideos)
    .set({
      externalPlayUrl: playResult.data.url,
      metadata: {
        ...(existing.metadata ?? {}),
        playUrl: playResult.data.url,
        lastFetchedAt: new Date().toISOString(),
      },
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(t.collectedVideos.id, existing.id));

  await logCollectionJob(collectionJobId, 'info', '播放地址已刷新', { externalId });
}

// --------------------------------------------------------------------------
// R2 转存（分片下载 → AES-128 解密 → 上传对象存储）
// --------------------------------------------------------------------------

async function r2TransferJob(job: Job<R2TransferJobData>): Promise<void> {
  const { collectedVideoId, onlyBitrate } = job.data;
  const collectionJobId = (job.data as { collectionJobId?: string }).collectionJobId;

  const service = R2TransferService.getInstance();
  const result = await service.transferVideo(collectedVideoId, {
    onlyBitrate,
    onProgress: (percent, stage) => {
      // 进度写回 BullMQ job（Dashboard 可实时读取）
      void job.updateProgress({ percent, stage }).catch(() => undefined);
    },
  });

  await logCollectionJob(
    collectionJobId,
    'info',
    `R2 转存完成：${result.renditions.length} 个码率档，共 ${(result.totalBytes / 1024 / 1024).toFixed(1)}MB`,
    { collectedVideoId, ...result },
  );
}

// --------------------------------------------------------------------------
// 辅助
// --------------------------------------------------------------------------

async function requireAccount(targetSite: string): Promise<AccountPoolEntry> {
  const account = await AccountPoolManager.getInstance().getAvailableAccount(targetSite);
  if (!account) throw new Error('号池中无可用账号');
  return account;
}

async function logCollectionJob(
  collectionJobId: string | undefined,
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(t.collectionLogs).values({
      jobId: collectionJobId ?? null,
      level,
      message,
      context: context ?? null,
    });
  } catch (error) {
    // 日志失败不影响主流程
    logger.debug({ err: error }, '采集日志写入失败');
  }
}
