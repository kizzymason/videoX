// ========================================================================
// 采集系统 - 定时调度器（node-cron）
// 由 server.ts 启动时调用 scheduleCollectionTasks()
// ========================================================================

import * as cron from 'node-cron';
import { lt } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { enqueueCollectionJob, type CollectionJobType } from './queues/tasks.js';
import { getScheduleConfig, getPoolConfig } from './storage/config.js';
import { AccountPoolManager } from './pool-manager.js';

const TARGET_SITE = 'yitongkan' as const;
const KINDS = ['gv', 'mv', 'tv'] as const;

const scheduledTasks: cron.ScheduledTask[] = [];

/** 简易防重入锁：上一个 cron 触发还没跑完时跳过本次 */
const runningFlags = new Map<string, boolean>();
let lastPoolHealthCheckAt = 0;

async function runExclusively(key: string, fn: () => Promise<void>): Promise<void> {
  if (runningFlags.get(key)) {
    logger.warn({ job: key }, '上一次调度仍在执行，跳过本次触发');
    return;
  }
  runningFlags.set(key, true);
  try {
    await fn();
  } finally {
    runningFlags.set(key, false);
  }
}

/**
 * 配置全部定时任务（幂等：重复调用先清空旧任务）
 */
export function scheduleCollectionTasks(): void {
  for (const task of scheduledTasks) task.stop();
  scheduledTasks.length = 0;

  // 1. 每日增量抓取（凌晨 3 点）
  scheduledTasks.push(
    cron.schedule('0 3 * * *', () => void runExclusively('daily', runDailyIncrementalCrawl)),
  );

  // 2. 每周全量抓取（周日凌晨 4 点）
  scheduledTasks.push(
    cron.schedule('0 4 * * 0', () => void runExclusively('weekly', runWeeklyFullCrawl)),
  );

  // 3. 号池健康检查：每 5 分钟唤醒一次，实际间隔由号池配置决定。
  scheduledTasks.push(
    cron.schedule('*/5 * * * *', () => void runExclusively('healthcheck', runScheduledHealthCheck)),
  );

  // 进程重启后立即校验并恢复账号，避免等待下一个整点窗口。
  void runExclusively('healthcheck-startup', runScheduledHealthCheck);

  // 4. 定期清理过期日志（每周一凌晨 5 点）
  scheduledTasks.push(
    cron.schedule('0 5 * * 1', () => void runExclusively('logcleanup', runLogCleanup)),
  );

  logger.info('采集调度器已就绪：每日增量(03:00) / 每周全量(周日 04:00) / 号池健康检查(按配置，最小 5 分钟) / 日志清理(周一 05:00)');
}

/**
 * 每日增量抓取：
 * 抓 gv/mv/tv 三类的前 N 页（N 可在后台配置），priority 50，页间延迟 1s
 */
async function runDailyIncrementalCrawl(): Promise<void> {
  logger.info('开始每日增量抓取任务');
  try {
    const config = await getScheduleConfig('daily');
    if (!config.enabled) {
      logger.warn('每日增量抓取已禁用，跳过本次执行');
      return;
    }

    const pageCount = config.pageCountPerRun || 5;
    for (const kind of KINDS) {
      for (let page = 1; page <= pageCount; page++) {
        await enqueueCollectionJob({
          taskId: `daily_${kind}_page_${page}_${dayStamp()}`,
          type: 'list_crawl',
          payload: { targetSite: TARGET_SITE, kind, page },
          priority: page === 1 ? 100 : 50,
          delayMs: page * 1000,
        });
      }
    }

    logger.info({ kinds: KINDS.length, pageCount }, '每日增量抓取任务已入队');
  } catch (error) {
    logger.error({ err: error }, '每日增量抓取任务失败');
  }
}

/**
 * 每周全量抓取：gv/mv/tv 各 N 页（页间 0.5s 延迟）
 */
async function runWeeklyFullCrawl(): Promise<void> {
  logger.info('开始每周全量抓取任务');
  try {
    const config = await getScheduleConfig('weekly');
    if (!config.enabled) {
      logger.warn('每周全量抓取已禁用，跳过本次执行');
      return;
    }

    const MAX_PAGES = 50;
    for (const kind of KINDS) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        await enqueueCollectionJob({
          taskId: `weekly_${kind}_page_${page}_${dayStamp()}`,
          type: 'list_crawl',
          payload: { targetSite: TARGET_SITE, kind, page },
          priority: 80,
          delayMs: page * 500,
        });
      }
    }

    logger.info({ pages: MAX_PAGES * KINDS.length }, '每周全量抓取任务已入队');
  } catch (error) {
    logger.error({ err: error }, '每周全量抓取任务失败');
  }
}

/**
 * 管理员手动全量抓取：从第 1 页翻到源站末页或指定上限，已入库的跳过但继续翻页。
 */
export async function enqueueFullCrawl(params?: {
  kinds?: Array<(typeof KINDS)[number]>;
  maxPages?: number;
}): Promise<{ runId: string; enqueued: number; kinds: string[]; maxPages: number }> {
  const kinds = params?.kinds?.length ? params.kinds : [...KINDS];
  const maxPages = Math.min(2000, Math.max(1, params?.maxPages ?? 200));
  const runId = `full_${Date.now()}`;
  const enqueued = await enqueueCrawlRun({
    runId,
    incremental: false,
    maxPages,
    kinds,
    priority: 120,
  });
  logger.info({ runId, kinds, maxPages, enqueued }, '手动全量抓取已入队');
  return { runId, enqueued, kinds, maxPages };
}

async function enqueueCrawlRun(params: {
  runId: string;
  incremental: boolean;
  maxPages: number;
  kinds: Array<(typeof KINDS)[number]>;
  priority: number;
}): Promise<number> {
  let enqueued = 0;
  for (const kind of params.kinds) {
    await enqueueCollectionJob({
      taskId: `${params.runId}_${kind}_p1`,
      type: 'list_crawl',
      payload: {
        targetSite: TARGET_SITE,
        kind,
        page: 1,
        incremental: params.incremental,
        maxPages: params.maxPages,
        runId: params.runId,
      },
      priority: params.priority,
    });
    enqueued += 1;
  }
  return enqueued;
}

/**
 * 每小时号池健康检查：
 * 逐账号调用源站 /api/member/me，自动标记失效账号、刷新 VIP 状态
 */
async function runHourlyHealthCheck(): Promise<void> {
  logger.info('开始小时号池健康检查');
  try {
    const manager = AccountPoolManager.getInstance();
    const result = await manager.healthCheckAll(TARGET_SITE);
    logger.info({ ...result }, '小时号池健康检查完成');

    if (result.valid === 0) {
      logger.warn('号池健康检查后无有效账号，采集与热链播放将不可用');
    }
  } catch (error) {
    logger.error({ err: error }, '小时号池健康检查失败');
  }
}

async function runScheduledHealthCheck(): Promise<void> {
  try {
    const config = await getPoolConfig(TARGET_SITE);
    const intervalMs = Math.max(5, config.healthCheckIntervalMinutes || 60) * 60 * 1000;
    if (Date.now() - lastPoolHealthCheckAt < intervalMs) return;
    lastPoolHealthCheckAt = Date.now();
    await runHourlyHealthCheck();
  } catch (error) {
    logger.error({ err: error }, '号池健康检查调度失败');
  }
}

/**
 * 定期清理过期采集日志（保留 30 天）
 */
async function runLogCleanup(): Promise<void> {
  logger.info('开始清理过期采集日志');
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(t.collectionLogs)
      .where(lt(t.collectionLogs.createdAt, thirtyDaysAgo))
      .returning({ id: t.collectionLogs.id });

    logger.info({ deleted: deleted.length }, '过期采集日志已清理');
  } catch (error) {
    logger.error({ err: error }, '清理过期采集日志失败');
  }
}

/**
 * 手动触发单次任务（供 API routes 调用）
 */
export async function triggerManualTask(
  type: CollectionJobType,
  payload: Record<string, unknown>,
  priority = 200,
): Promise<{ collectionJobId: string; bullmqJobId: string }> {
  const result = await enqueueCollectionJob({
    taskId: `manual_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    priority,
  });

  logger.info({ ...result, type, payload }, '手动任务已入队');
  return result;
}

/** 停止所有定时任务（进程退出时调用） */
export function stopScheduledTasks(): void {
  for (const task of scheduledTasks) task.stop();
  scheduledTasks.length = 0;
  logger.info('所有定时采集任务已停止');
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
