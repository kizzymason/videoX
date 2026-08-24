// ========================================================================
// SEO 系统 - 定时调度（node-cron）
// 由 server.ts 在持有调度权的进程里调用 scheduleSeoTasks()。
// ========================================================================

import * as cron from 'node-cron';
import { logger } from '../../core/logger.js';
import { getSeoSettings } from './settings.js';
import { pushNewlyPublishedVideos, retryFailedSubmissions } from './push/service.js';
import { runSeoKeywordBatch } from './ai-optimizer.js';

const scheduledTasks: cron.ScheduledTask[] = [];
const runningFlags = new Map<string, boolean>();

async function runExclusively(key: string, fn: () => Promise<void>): Promise<void> {
  if (runningFlags.get(key)) {
    logger.warn({ job: key }, '上一次 SEO 调度仍在执行，跳过本次触发');
    return;
  }
  runningFlags.set(key, true);
  try {
    await fn();
  } finally {
    runningFlags.set(key, false);
  }
}

async function runAutoPush(): Promise<void> {
  try {
    const settings = await getSeoSettings();
    if (!settings.autoPushEnabled) return;
    const results = await pushNewlyPublishedVideos();
    if (results.length > 0) logger.info({ results }, 'SEO 自动推送完成');
  } catch (error) {
    logger.error({ err: error }, 'SEO 自动推送失败');
  }
}

async function runRetry(): Promise<void> {
  try {
    const settings = await getSeoSettings();
    if (!settings.autoPushEnabled) return;
    const results = await retryFailedSubmissions();
    if (results.length > 0) logger.info({ results }, 'SEO 失败推送重试完成');
  } catch (error) {
    logger.error({ err: error }, 'SEO 失败推送重试失败');
  }
}

async function runAiBatch(): Promise<void> {
  try {
    const settings = await getSeoSettings();
    if (!settings.ai.enabled) return;
    await runSeoKeywordBatch(settings.ai.dailyLimit);
  } catch (error) {
    logger.error({ err: error }, 'SEO 关键词批量生成失败');
  }
}

/** 配置全部 SEO 定时任务（幂等：重复调用先清空旧任务）。 */
export function scheduleSeoTasks(): void {
  for (const task of scheduledTasks) task.stop();
  scheduledTasks.length = 0;

  // 1. 每 10 分钟检查一次新发布视频，推送给搜索引擎
  scheduledTasks.push(cron.schedule('*/10 * * * *', () => void runExclusively('seo-push', runAutoPush)));

  // 2. 每 6 小时重试一次失败的推送
  scheduledTasks.push(cron.schedule('20 */6 * * *', () => void runExclusively('seo-retry', runRetry)));

  // 3. 每天凌晨 2:30 给新视频批量生成 AI 关键词（错开 3 点的采集任务）
  scheduledTasks.push(cron.schedule('30 2 * * *', () => void runExclusively('seo-ai', runAiBatch)));

  logger.info('SEO 调度器已就绪：自动推送(每 10 分钟) / 失败重试(每 6 小时) / AI 关键词(02:30)');
}

/** 停止所有 SEO 定时任务（进程退出时调用）。 */
export function stopSeoTasks(): void {
  for (const task of scheduledTasks) task.stop();
  scheduledTasks.length = 0;
}
