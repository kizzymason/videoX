// ========================================================================
// 采集系统 - 队列定义与任务创建统一入口
// ========================================================================

import { Queue, QueueEvents, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createQueueConnection } from '../../../core/redis.js';
import { QUEUE_PREFIX } from '../../../core/queue.js';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';

export const QUEUE_COLLECTION = 'collection';

// --------------------------------------------------------------------------
// 任务数据类型
// --------------------------------------------------------------------------

export interface ListCrawlJobData {
  /** collection_jobs 表的持久化记录 ID */
  collectionJobId?: string;
  targetSite: 'yitongkan';
  kind: 'gv' | 'mv' | 'tv';
  page: number;
  totalPages?: number;
  /** 增量：本页没有新视频就停；全量：一直翻到结束页，按批次间隔自动切批 */
  incremental?: boolean;
  maxPages?: number;
  endPage?: number;
  pagesPerBatch?: number;
  batchIntervalSeconds?: number;
  runId?: string;
}

export interface DetailFetchJobData {
  collectionJobId?: string;
  targetSite: 'yitongkan';
  kind: 'gv' | 'mv' | 'tv';
  externalId: number;
}

export interface PlayUrlRefreshJobData {
  collectionJobId?: string;
  targetSite: 'yitongkan';
  externalId: number;
}

export interface R2TransferJobData {
  collectionJobId?: string;
  targetSite: 'yitongkan';
  /** collected_videos 表记录 ID */
  collectedVideoId: string;
  /** 只转存指定码率（如 '1800'），不传则全部 */
  onlyBitrate?: string;
}

export type CollectionJobData =
  | ListCrawlJobData
  | DetailFetchJobData
  | PlayUrlRefreshJobData
  | R2TransferJobData;

export type CollectionJobType = 'list_crawl' | 'detail_fetch' | 'play_url_refresh' | 'r2_transfer';

// --------------------------------------------------------------------------
// BullMQ Queue 实例
// --------------------------------------------------------------------------

let collectionQueue: Queue<CollectionJobData> | null = null;
let collectionQueueEvents: QueueEvents | null = null;

export function getCollectionQueue(): Queue<CollectionJobData> {
  collectionQueue ??= new Queue<CollectionJobData>(QUEUE_COLLECTION, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });
  return collectionQueue;
}

export function getCollectionQueueEvents(): QueueEvents {
  collectionQueueEvents ??= new QueueEvents(QUEUE_COLLECTION, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
  });
  return collectionQueueEvents;
}

// --------------------------------------------------------------------------
// 任务创建统一入口：先落库（供 UI 展示/审计），再入 BullMQ 队列
// --------------------------------------------------------------------------

export interface EnqueueOptions {
  /** 业务任务 ID（如 daily_gv_page_1），同时作为 BullMQ jobId 保证幂等 */
  taskId: string;
  type: CollectionJobType;
  payload: Record<string, unknown>;
  priority?: number;
  delayMs?: number;
}

/**
 * 创建采集任务：
 * 1. 插入 collection_jobs 记录（持久化，Dashboard/任务列表的数据源）
 * 2. 加入 BullMQ 队列（job data 携带 collectionJobId，worker 处理时回写状态）
 *
 * 同名 taskId 重复入队是幂等的：BullMQ 按 jobId 去重，DB 侧 upsert。
 */
export async function enqueueCollectionJob(options: EnqueueOptions): Promise<{
  collectionJobId: string;
  bullmqJobId: string;
}> {
  const queue = getCollectionQueue();

  // 1. DB 记录（已存在同名 taskId 则复用，重置为 queued）
  const [existing] = await db
    .select({ id: t.collectionJobs.id })
    .from(t.collectionJobs)
    .where(eq(t.collectionJobs.taskId, options.taskId))
    .limit(1);

  let collectionJobId: string;
  if (existing) {
    collectionJobId = existing.id;
    await db
      .update(t.collectionJobs)
      .set({
        status: 'queued',
        payload: options.payload,
        priority: options.priority ?? 0,
        retryCount: 0,
        errorMessage: null,
        nextRunAt: new Date(Date.now() + (options.delayMs ?? 0)),
        updatedAt: new Date(),
      })
      .where(eq(t.collectionJobs.id, collectionJobId));
  } else {
    const [inserted] = await db
      .insert(t.collectionJobs)
      .values({
        taskId: options.taskId,
        type: options.type,
        targetSite: (options.payload.targetSite as string) ?? 'yitongkan',
        status: 'queued',
        priority: options.priority ?? 0,
        payload: options.payload,
        nextRunAt: new Date(Date.now() + (options.delayMs ?? 0)),
      })
      .returning({ id: t.collectionJobs.id });
    collectionJobId = inserted!.id;
  }

  // 2. BullMQ 入队
  await queue.add(options.type, { ...options.payload, collectionJobId } as CollectionJobData, {
    jobId: options.taskId,
    priority: options.priority ?? 0,
    delay: options.delayMs ?? 0,
  });

  logger.debug({ taskId: options.taskId, type: options.type, collectionJobId }, '采集任务已入队');

  return { collectionJobId, bullmqJobId: options.taskId };
}

// --------------------------------------------------------------------------
// 任务状态回写（worker 调用）
// --------------------------------------------------------------------------

export async function markJobRunning(collectionJobId: string): Promise<void> {
  await db
    .update(t.collectionJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(t.collectionJobs.id, collectionJobId));
}

export async function markJobCompleted(collectionJobId: string): Promise<void> {
  await db
    .update(t.collectionJobs)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(t.collectionJobs.id, collectionJobId));
}

export async function markJobFailed(collectionJobId: string, error: string): Promise<void> {
  await db
    .update(t.collectionJobs)
    .set({
      status: 'failed',
      errorMessage: error.slice(0, 2000),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(t.collectionJobs.id, collectionJobId));
}

/** worker 重试时更新重试计数 */
export async function markJobRetry(collectionJobId: string, retryCount: number): Promise<void> {
  await db
    .update(t.collectionJobs)
    .set({
      status: 'queued',
      retryCount,
      updatedAt: new Date(),
    })
    .where(eq(t.collectionJobs.id, collectionJobId));
}

// --------------------------------------------------------------------------
// 队列清理
// --------------------------------------------------------------------------

export async function closeCollectionQueue(): Promise<void> {
  if (collectionQueue) {
    await collectionQueue.close();
    collectionQueue = null;
  }
  if (collectionQueueEvents) {
    await collectionQueueEvents.close();
    collectionQueueEvents = null;
  }
}

/** 给 Dashboard 用：读取队列实时状态（等待/活跃数） */
export async function getQueueStats(): Promise<{ waiting: number; active: number; failed: number }> {
  const queue = getCollectionQueue();
  const counts = await queue.getJobCounts('waiting', 'active', 'failed');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
  };
}

/** 导出 BullMQ Job 类型给 worker 使用 */
export type CollectionBullmqJob = Job<CollectionJobData>;
