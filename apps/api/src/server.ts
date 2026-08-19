import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { closeDb } from './core/db.js';
import { closeRedis } from './core/redis.js';
import { closeQueues, scheduleMaintenance } from './core/queue.js';
import { scheduleCollectionTasks, stopScheduledTasks } from './modules/collection/scheduler.js';

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
      },
      `videoX API 已启动：${env.API_PUBLIC_URL}`,
    );
  });

  // HLS 分片是长连接小请求，把 keep-alive 调高避免频繁握手。
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await scheduleMaintenance().catch((error) => {
    logger.warn({ err: error }, '周期任务注册失败，Redis 可能未就绪');
  });

  // 采集系统定时任务（每日增量/每周全量/号池健康检查/日志清理）
  scheduleCollectionTasks();

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

void bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'API 启动失败');
  process.exit(1);
});
