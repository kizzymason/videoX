import cluster from 'node:cluster';
import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { closeDb } from './core/db.js';
import { closeRedis } from './core/redis.js';
import { closeQueues, scheduleMaintenance } from './core/queue.js';
import { scheduleCollectionTasks, stopScheduledTasks } from './modules/collection/scheduler.js';

/**
 * 定时任务只能有一份。
 *
 * cluster 下每个 worker 都会跑一遍 bootstrap，node-cron 的采集调度如果各 fork
 * 各自注册，一次增量采集会被入队 N 次。约定只有 1 号 worker 管调度。
 */
function ownsScheduler(): boolean {
  return !cluster.isWorker || cluster.worker?.id === 1;
}

function runPrimary(workers: number): void {
  logger.info({ workers }, `videoX API 以 cluster 模式启动（${workers} 个进程）`);

  for (let i = 0; i < workers; i += 1) cluster.fork();

  let shuttingDown = false;
  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    logger.error({ pid: worker.process.pid, code, signal }, 'API worker 退出，正在重建');
    cluster.fork();
  });

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '正在关闭 API cluster…');
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill(signal as NodeJS.Signals);
    setTimeout(() => process.exit(0), 12_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function bootstrap() {
  // 本地驱动需要这些目录存在，提前建好省得第一次上传时报错。
  await fs.mkdir(env.storageRoot, { recursive: true });
  await fs.mkdir(env.uploadTmpDir, { recursive: true });

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    logger.info(
      {
        port: env.API_PORT,
        env: env.NODE_ENV,
        storage: env.STORAGE_DRIVER,
        accel: env.MEDIA_ACCEL_PREFIX || 'off',
        workerId: cluster.worker?.id ?? null,
      },
      `videoX API 已启动：${env.API_PUBLIC_URL}`,
    );
  });

  // HLS 分片是长连接小请求，把 keep-alive 调高避免频繁握手。
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  if (ownsScheduler()) {
    await scheduleMaintenance().catch((error) => {
      logger.warn({ err: error }, '周期任务注册失败，Redis 可能未就绪');
    });

    // 采集系统定时任务（每日增量/每周全量/号池健康检查/日志清理）
    scheduleCollectionTasks();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '正在关闭服务…');

    server.close(() => logger.info('HTTP 服务已关闭'));
    stopScheduledTasks();
    // 给在途请求 10 秒收尾，超时强制退出。
    const force = setTimeout(() => {
      logger.warn('优雅关闭超时，强制退出');
      process.exit(1);
    }, 10_000);
    force.unref();

    await Promise.allSettled([closeQueues(), closeRedis(), closeDb()]);
    clearTimeout(force);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, '未处理的 Promise 拒绝');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, '未捕获的异常');
    void shutdown('uncaughtException');
  });
}

if (env.API_CLUSTER_WORKERS > 1 && cluster.isPrimary) {
  runPrimary(env.API_CLUSTER_WORKERS);
} else {
  void bootstrap().catch((error) => {
    logger.fatal({ err: error }, 'API 启动失败');
    process.exit(1);
  });
}
