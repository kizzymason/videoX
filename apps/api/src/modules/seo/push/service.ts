// ========================================================================
// SEO 系统 - 推送执行与记录
//
// seo_submissions 每个 (engine, url) 一行：既是日志也是去重依据。
// 自动推送靠「扫描已发布视频里还没成功推送的」实现，天然覆盖所有发布入口
// （后台发布、采集入库、AI 工具），不需要在每个入口挂钩子。
// ========================================================================

import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import type { SeoEngine, SeoPushResult, SeoSubmissionItem } from '@videox/shared';
import { db, t, sqlRows } from '../../../core/db.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../core/logger.js';
import { getSeoSettings } from '../settings.js';
import {
  BAIDU_BATCH_SIZE,
  INDEXNOW_BATCH_SIZE,
  buildBaiduPushRequest,
  buildIndexNowRequest,
  chunk,
  isValidIndexNowKey,
  normalizeSiteOrigin,
  parseBaiduResponse,
  parseIndexNowResponse,
  toAbsoluteUrls,
} from './engines.js';

/** 除视频页外始终值得推送的核心页面。 */
export const CORE_PAGE_PATHS = ['/', '/categories', '/shorts'] as const;

const FETCH_TIMEOUT_MS = 30_000;

export function siteOrigin(): string {
  return normalizeSiteOrigin(env.SITE_PUBLIC_URL);
}

interface BatchOutcome {
  ok: boolean;
  httpStatus: number | null;
  message: string;
}

async function submitBatch(engine: SeoEngine, urls: string[]): Promise<BatchOutcome> {
  const settings = await getSeoSettings();
  try {
    if (engine === 'indexnow') {
      const request = buildIndexNowRequest(siteOrigin(), settings.indexNow.key, urls);
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(request.payload),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await response.text().catch(() => '');
      const parsed = parseIndexNowResponse(response.status, text);
      return { ok: parsed.ok, httpStatus: response.status, message: parsed.message };
    }

    const site = settings.baidu.site || siteOrigin();
    const request = buildBaiduPushRequest(site, settings.baidu.token, urls);
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: request.body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await response.text().catch(() => '');
    const parsed = parseBaiduResponse(response.status, text);
    return { ok: parsed.ok, httpStatus: response.status, message: parsed.message };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, httpStatus: null, message: `请求搜索引擎失败：${reason}` };
  }
}

async function recordSubmissions(
  engine: SeoEngine,
  urls: string[],
  outcome: BatchOutcome,
  trigger: 'auto' | 'manual',
): Promise<void> {
  if (urls.length === 0) return;
  const now = new Date();
  const status = outcome.ok ? 'success' : 'failed';
  const values = urls.map((url) => ({
    engine,
    url,
    status: status as 'success' | 'failed',
    attempts: 1,
    httpStatus: outcome.httpStatus,
    response: outcome.message.slice(0, 500),
    trigger,
    submittedAt: now,
  }));
  await db
    .insert(t.seoSubmissions)
    .values(values)
    .onConflictDoUpdate({
      target: [t.seoSubmissions.engine, t.seoSubmissions.url],
      set: {
        status,
        attempts: dsql`${t.seoSubmissions.attempts} + 1`,
        httpStatus: outcome.httpStatus,
        response: outcome.message.slice(0, 500),
        trigger,
        submittedAt: now,
        updatedAt: now,
      },
    });
}

async function engineEnabled(engine: SeoEngine): Promise<{ enabled: boolean; reason?: string }> {
  const settings = await getSeoSettings();
  if (engine === 'indexnow') {
    if (!settings.indexNow.enabled) return { enabled: false, reason: 'IndexNow 未启用' };
    if (!isValidIndexNowKey(settings.indexNow.key)) return { enabled: false, reason: 'IndexNow key 未配置或格式非法' };
    return { enabled: true };
  }
  if (!settings.baidu.enabled) return { enabled: false, reason: '百度推送未启用' };
  if (!settings.baidu.token) return { enabled: false, reason: '百度 token 未配置' };
  return { enabled: true };
}

/** 把一批 URL 推给指定搜索引擎，逐批提交并落库。 */
export async function pushUrlsToEngine(
  engine: SeoEngine,
  rawUrls: string[],
  trigger: 'auto' | 'manual',
): Promise<SeoPushResult> {
  const gate = await engineEnabled(engine);
  if (!gate.enabled) {
    return { engine, submitted: 0, succeeded: 0, failed: 0, skipped: rawUrls.length, message: gate.reason };
  }

  const urls = toAbsoluteUrls(rawUrls, siteOrigin());
  const batchSize = engine === 'indexnow' ? INDEXNOW_BATCH_SIZE : BAIDU_BATCH_SIZE;
  let succeeded = 0;
  let failed = 0;
  let lastMessage = '';

  for (const batch of chunk(urls, batchSize)) {
    const outcome = await submitBatch(engine, batch);
    await recordSubmissions(engine, batch, outcome, trigger);
    lastMessage = outcome.message;
    if (outcome.ok) succeeded += batch.length;
    else failed += batch.length;
    // 百度配额耗尽后继续推只会刷失败记录，直接停。
    if (!outcome.ok && engine === 'baidu' && outcome.httpStatus === 400) break;
  }

  logger.info({ engine, submitted: urls.length, succeeded, failed, trigger }, 'SEO 推送完成');
  return {
    engine,
    submitted: urls.length,
    succeeded,
    failed,
    skipped: rawUrls.length - urls.length,
    message: lastMessage,
  };
}

/** 把同一批 URL 推给所有启用的引擎（手动推送用）。 */
export async function pushUrls(rawUrls: string[], trigger: 'auto' | 'manual'): Promise<SeoPushResult[]> {
  const results: SeoPushResult[] = [];
  for (const engine of ['indexnow', 'baidu'] as const) {
    results.push(await pushUrlsToEngine(engine, rawUrls, trigger));
  }
  return results;
}

/** 找出指定引擎还没成功推送过的已发布视频 watch URL（新→旧）。 */
export async function findUnpushedWatchUrls(engine: SeoEngine, limit: number): Promise<string[]> {
  const origin = siteOrigin();
  const rows = await sqlRows<{ slug: string }>(dsql`
    SELECT v.slug FROM videos v
    WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM seo_submissions s
        WHERE s.engine = ${engine} AND s.status = 'success'
          AND s.url = ${origin} || '/watch/' || v.slug
      )
    ORDER BY coalesce(v.published_at, v.created_at) DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => `${origin}/watch/${r.slug}`);
}

/** 自动推送：每个启用的引擎各自补齐没推过的视频。由调度器周期调用。 */
export async function pushNewlyPublishedVideos(): Promise<SeoPushResult[]> {
  const settings = await getSeoSettings();
  const results: SeoPushResult[] = [];
  for (const engine of ['indexnow', 'baidu'] as const) {
    const gate = await engineEnabled(engine);
    if (!gate.enabled) continue;
    const urls = await findUnpushedWatchUrls(engine, settings.pushBatchSize);
    if (urls.length === 0) continue;
    results.push(await pushUrlsToEngine(engine, [...CORE_PAGE_PATHS, ...urls], 'auto'));
  }
  return results;
}

/** 全量重推：所有已发布视频 + 核心页面（上限保护）。 */
export async function pushAllPublished(limit = 10_000): Promise<SeoPushResult[]> {
  const origin = siteOrigin();
  const rows = await sqlRows<{ slug: string }>(dsql`
    SELECT slug FROM videos
    WHERE status IN ('ready','partially_ready') AND visibility = 'public'
    ORDER BY coalesce(published_at, created_at) DESC
    LIMIT ${limit}
  `);
  const urls = [...CORE_PAGE_PATHS.map((p) => `${origin}${p === '/' ? '' : p}` || origin), ...rows.map((r) => `${origin}/watch/${r.slug}`)];
  return pushUrls(urls, 'manual');
}

/** 重试失败的推送记录。 */
export async function retryFailedSubmissions(limitPerEngine = 500): Promise<SeoPushResult[]> {
  const results: SeoPushResult[] = [];
  for (const engine of ['indexnow', 'baidu'] as const) {
    const gate = await engineEnabled(engine);
    if (!gate.enabled) continue;
    const rows = await db
      .select({ url: t.seoSubmissions.url })
      .from(t.seoSubmissions)
      .where(and(eq(t.seoSubmissions.engine, engine), eq(t.seoSubmissions.status, 'failed')))
      .orderBy(desc(t.seoSubmissions.updatedAt))
      .limit(limitPerEngine);
    if (rows.length === 0) continue;
    results.push(await pushUrlsToEngine(engine, rows.map((r) => r.url), 'manual'));
  }
  return results;
}

export async function listSubmissions(options: {
  page: number;
  pageSize: number;
  engine?: SeoEngine;
  status?: 'pending' | 'success' | 'failed';
}): Promise<{ items: SeoSubmissionItem[]; total: number }> {
  const filters = [
    options.engine ? eq(t.seoSubmissions.engine, options.engine) : undefined,
    options.status ? eq(t.seoSubmissions.status, options.status) : undefined,
  ].filter((f): f is NonNullable<typeof f> => Boolean(f));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(t.seoSubmissions)
      .where(where)
      .orderBy(desc(t.seoSubmissions.updatedAt))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    db.select({ total: dsql<number>`count(*)::int` }).from(t.seoSubmissions).where(where),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      engine: row.engine,
      url: row.url,
      status: row.status,
      attempts: row.attempts,
      httpStatus: row.httpStatus,
      response: row.response,
      trigger: row.trigger,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total: Number(countRows[0]?.total ?? 0),
  };
}
