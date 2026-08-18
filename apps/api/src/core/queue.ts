import { Queue, QueueEvents } from 'bullmq';
import { createQueueConnection } from './redis.js';
import { logger } from './logger.js';

// BullMQ 不允许队列名带冒号，命名空间只能走 prefix 选项。
export const QUEUE_PREFIX = 'videox';
export const QUEUE_TRANSCODE = 'transcode';
export const QUEUE_AI_SCORING = 'ai-scoring';
export const QUEUE_MAINTENANCE = 'maintenance';

export interface TranscodeJobData {
  videoId: string;
  jobId: string;
  /** 源文件在存储层的 key */
  sourceKey: string;
  /** 会员视频要做 AES-128 加密 */
  encrypt: boolean;
  /** 重转码时跳过封面与雪碧图生成 */
  skipAssets?: boolean;
}

export interface AiScoringJobData {
  profileId: string;
  runId: string;
  /** 留空表示对全部可播视频打分 */
  videoIds?: string[];
}

export interface MaintenanceJobData {
  task: 'aggregate_stats' | 'decay_affinity' | 'prune_tokens' | 'refresh_quality';
}

let transcodeQueue: Queue<TranscodeJobData> | null = null;
let aiQueue: Queue<AiScoringJobData> | null = null;
let maintenanceQueue: Queue<MaintenanceJobData> | null = null;

export function getTranscodeQueue(): Queue<TranscodeJobData> {
  transcodeQueue ??= new Queue<TranscodeJobData>(QUEUE_TRANSCODE, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return transcodeQueue;
}

export function getAiQueue(): Queue<AiScoringJobData> {
  aiQueue ??= new Queue<AiScoringJobData>(QUEUE_AI_SCORING, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  });
  return aiQueue;
}

export function getMaintenanceQueue(): Queue<MaintenanceJobData> {
  maintenanceQueue ??= new Queue<MaintenanceJobData>(QUEUE_MAINTENANCE, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
  });
  return maintenanceQueue;
}

/** 注册周期任务。重复注册同名 scheduler 是幂等的。 */
export async function scheduleMaintenance(): Promise<void> {
  const queue = getMaintenanceQueue();
  try {
    await queue.upsertJobScheduler(
      'aggregate-stats',
      { pattern: '*/10 * * * *' },
      { name: 'aggregate_stats', data: { task: 'aggregate_stats' } },
    );
    await queue.upsertJobScheduler(
      'decay-affinity',
      { pattern: '0 4 * * *' },
      { name: 'decay_affinity', data: { task: 'decay_affinity' } },
    );
    await queue.upsertJobScheduler(
      'prune-tokens',
      { pattern: '0 5 * * *' },
      { name: 'prune_tokens', data: { task: 'prune_tokens' } },
    );
    await queue.upsertJobScheduler(
      'refresh-quality',
      { pattern: '30 * * * *' },
      { name: 'refresh_quality', data: { task: 'refresh_quality' } },
    );
    logger.info('周期任务已注册');
  } catch (error) {
    logger.warn({ err: error }, '周期任务注册失败');
  }
}

/** 转码进度推送给管理后台的 SSE 连接。 */
let transcodeEvents: QueueEvents | null = null;

export function getTranscodeEvents(): QueueEvents {
  transcodeEvents ??= new QueueEvents(QUEUE_TRANSCODE, { connection: createQueueConnection(), prefix: QUEUE_PREFIX });
  return transcodeEvents;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    transcodeQueue?.close(),
    aiQueue?.close(),
    maintenanceQueue?.close(),
    transcodeEvents?.close(),
  ]);
  transcodeQueue = null;
  aiQueue = null;
  maintenanceQueue = null;
  transcodeEvents = null;
}
