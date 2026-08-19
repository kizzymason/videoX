import os from 'node:os';
import { Worker, type Job } from 'bullmq';
import { env } from '@videox/api/config/env';
import { createQueueConnection, closeRedis } from '@videox/api/core/redis';
import { closeDb } from '@videox/api/core/db';
import {
  QUEUE_AI_SCORING,
  QUEUE_MAINTENANCE,
  QUEUE_PREFIX,
  QUEUE_TRANSCODE,
  type AiScoringJobData,
  type MaintenanceJobData,
  type TranscodeJobData,
} from '@videox/api/core/queue';
import { QUEUE_COLLECTION, type CollectionJobData } from '@videox/api/collection';
import { logger } from './logger.js';
import { FFMPEG_BIN, FFPROBE_BIN } from './ffmpeg.js';
import { runTranscodeJob } from './jobs/transcode.js';
import { runAiScoringJob } from './jobs/ai-scoring.js';
import { runMaintenanceJob } from './jobs/maintenance.js';
import { runCollectionJob } from './jobs/collection.js';

/** 留一个核给系统与 API，避免转码把机器压死导致接口超时。 */
const transcodeConcurrency = Math.max(1, Math.min(env.TRANSCODE_CONCURRENCY, Math.max(1, os.cpus().length - 1)));

function attachLogging(worker: Worker, name: string): void {
  worker.on('completed', (job: Job) => {
    logger.info({ queue: name, jobId: job.id, jobName: job.name }, '任务完成');
  });
  worker.on('failed', (job, error) => {
    logger.error({ queue: name, jobId: job?.id, err: error }, '任务失败');
  });
  worker.on('error', (error) => {
    logger.error({ queue: name, err: error }, 'worker 异常');
  });
}

async function bootstrap(): Promise<void> {
  logger.info(
    {
      ffmpeg: FFMPEG_BIN,
      ffprobe: FFPROBE_BIN,
      transcodeConcurrency,
      hwaccel: env.TRANSCODE_HWACCEL,
      preset: env.TRANSCODE_PRESET,
    },
    'videoX worker 启动中',
  );

  const transcodeWorker = new Worker<TranscodeJobData>(QUEUE_TRANSCODE, runTranscodeJob, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: transcodeConcurrency,
    // 转码是长任务，锁续期间隔调长，避免被误判为卡死而重复消费。
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  });

  const aiWorker = new Worker<AiScoringJobData>(QUEUE_AI_SCORING, runAiScoringJob, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    lockDuration: 300_000,
  });

  const maintenanceWorker = new Worker<MaintenanceJobData>(QUEUE_MAINTENANCE, runMaintenanceJob, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });

  // 采集任务：网络 IO 为主（源站 API / 分片下载），并发可以比转码高。
  // R2 转存是长任务，锁续期调长避免误判卡死。
  const collectionWorker = new Worker<CollectionJobData>(QUEUE_COLLECTION, runCollectionJob, {
    connection: createQueueConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: Math.max(2, Math.min(8, os.cpus().length)),
    lockDuration: 300_000,
    stalledInterval: 60_000,
  });

  attachLogging(transcodeWorker, 'transcode');
  attachLogging(aiWorker, 'ai-scoring');
  attachLogging(maintenanceWorker, 'maintenance');
  attachLogging(collectionWorker, 'collection');

  logger.info('videoX worker 已就绪，等待任务');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '正在关闭 worker…');

    // close() 会等在跑的任务结束再退出，避免转码到一半留下半成品。
    await Promise.allSettled([
      transcodeWorker.close(),
      aiWorker.close(),
      maintenanceWorker.close(),
      collectionWorker.close(),
    ]);
    await Promise.allSettled([closeRedis(), closeDb()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, '未处理的 Promise 拒绝'));
}

void bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'worker 启动失败');
  process.exit(1);
});
