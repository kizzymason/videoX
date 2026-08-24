// ========================================================================
// SEO 系统 - 管理端 API（挂载于 /api/admin/seo，仅管理员）
// ========================================================================

import { Router } from 'express';
import { sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import {
  idSchema,
  seoKeywordListQuerySchema,
  seoManualPushSchema,
  seoSettingsSchema,
  seoSubmissionQuerySchema,
  videoSeoPatchSchema,
  type SeoEngine,
  type SeoOverview,
  type VideoSeoItem,
} from '@videox/shared';
import { sqlRows } from '../../core/db.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, params, query, validate } from '../../middleware/validate.js';
import { audit } from '../admin/audit.js';
import { generateVideoSeo, patchVideoSeo, runSeoKeywordBatch } from './ai-optimizer.js';
import {
  listSubmissions,
  pushAllPublished,
  pushNewlyPublishedVideos,
  pushUrls,
  retryFailedSubmissions,
} from './push/service.js';
import { getSeoSettings, maskSeoSettings, saveSeoSettings } from './settings.js';
import { generateIndexNowKey, isValidIndexNowKey } from './push/engines.js';
import { renderForCrawler } from './render.js';

export const seoAdminRouter: Router = Router();

seoAdminRouter.use(requireAuth, requireAdmin);

// --------------------------------------------------------------------------
// 概览
// --------------------------------------------------------------------------

seoAdminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const settings = await getSeoSettings();
    const [videoStats] = await sqlRows<{ published: number; generated: number }>(dsql`
      SELECT
        count(*)::int AS published,
        count(vs.video_id)::int AS generated
      FROM videos v
      LEFT JOIN video_seo vs ON vs.video_id = v.id
      WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
    `);
    const submissionRows = await sqlRows<{ engine: SeoEngine; status: string; total: number }>(dsql`
      SELECT engine, status, count(*)::int AS total FROM seo_submissions GROUP BY engine, status
    `);
    const [lastPush] = await sqlRows<{ last: string | null }>(dsql`
      SELECT max(submitted_at)::text AS last FROM seo_submissions WHERE trigger = 'auto'
    `);
    const [lastAi] = await sqlRows<{ last: string | null }>(dsql`
      SELECT max(generated_at)::text AS last FROM video_seo WHERE source = 'ai'
    `);

    const submissions: SeoOverview['submissions'] = {
      indexnow: { success: 0, failed: 0, pending: 0 },
      baidu: { success: 0, failed: 0, pending: 0 },
    };
    for (const row of submissionRows) {
      const bucket = submissions[row.engine];
      if (bucket && (row.status === 'success' || row.status === 'failed' || row.status === 'pending')) {
        bucket[row.status] = row.total;
      }
    }

    const published = Number(videoStats?.published ?? 0);
    const generated = Number(videoStats?.generated ?? 0);
    const overview: SeoOverview = {
      publishedVideos: published,
      seoGenerated: generated,
      seoMissing: Math.max(0, published - generated),
      submissions,
      lastAutoPushAt: lastPush?.last ?? null,
      lastAiRunAt: lastAi?.last ?? null,
      indexNowReady: settings.indexNow.enabled && isValidIndexNowKey(settings.indexNow.key),
      baiduReady: settings.baidu.enabled && Boolean(settings.baidu.token),
      aiReady: settings.ai.enabled && Boolean(settings.ai.endpoint && settings.ai.model),
    };
    ok(res, overview);
  }),
);

// --------------------------------------------------------------------------
// 设置
// --------------------------------------------------------------------------

seoAdminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    ok(res, maskSeoSettings(await getSeoSettings()));
  }),
);

seoAdminRouter.put(
  '/settings',
  validate({ body: seoSettingsSchema }),
  asyncHandler(async (req, res) => {
    const saved = await saveSeoSettings(body(req));
    await audit(req, 'settings.seo.update');
    ok(res, maskSeoSettings(saved), 'SEO 设置已保存');
  }),
);

seoAdminRouter.post(
  '/settings/indexnow-key',
  asyncHandler(async (req, res) => {
    const current = await getSeoSettings();
    const key = generateIndexNowKey();
    await saveSeoSettings({ ...current, indexNow: { ...current.indexNow, key } });
    await audit(req, 'settings.seo.indexnow_key');
    ok(res, { key }, '已生成新的 IndexNow key');
  }),
);

// --------------------------------------------------------------------------
// 推送
// --------------------------------------------------------------------------

seoAdminRouter.post(
  '/push',
  validate({ body: seoManualPushSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ urls?: string[]; scope?: 'new' | 'all' }>(req);
    let results;
    if (input.urls?.length) {
      results = await pushUrls(input.urls, 'manual');
    } else if (input.scope === 'all') {
      results = await pushAllPublished();
    } else {
      results = await pushNewlyPublishedVideos();
    }
    await audit(req, 'seo.push', undefined, { scope: input.scope ?? 'urls', count: input.urls?.length ?? 0 });
    ok(res, results, '推送已执行');
  }),
);

seoAdminRouter.post(
  '/push/retry',
  asyncHandler(async (req, res) => {
    const results = await retryFailedSubmissions();
    await audit(req, 'seo.push.retry');
    ok(res, results, '失败推送已重试');
  }),
);

seoAdminRouter.get(
  '/submissions',
  validate({ query: seoSubmissionQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      engine?: SeoEngine;
      status?: 'pending' | 'success' | 'failed';
    }>(req);
    const result = await listSubmissions(q);
    ok(res, paginated(result.items, result.total, q.page, q.pageSize));
  }),
);

// --------------------------------------------------------------------------
// AI 关键词
// --------------------------------------------------------------------------

seoAdminRouter.get(
  '/keywords',
  validate({ query: seoKeywordListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; pageSize: number; q?: string; filter: 'all' | 'missing' | 'generated' }>(req);
    const search = q.q?.trim();
    const filterSql =
      q.filter === 'missing'
        ? dsql`AND vs.video_id IS NULL`
        : q.filter === 'generated'
          ? dsql`AND vs.video_id IS NOT NULL`
          : dsql``;
    const searchSql = search ? dsql`AND v.title ILIKE ${'%' + search + '%'}` : dsql``;

    const rows = await sqlRows<{
      video_id: string;
      slug: string;
      title: string;
      published_at: string | null;
      seo_title: string | null;
      seo_description: string | null;
      keywords: string[] | null;
      source: 'ai' | 'manual' | null;
      ai_model: string | null;
      generated_at: string | null;
    }>(dsql`
      SELECT v.id AS video_id, v.slug, v.title, v.published_at::text,
             vs.seo_title, vs.seo_description, vs.keywords, vs.source, vs.ai_model, vs.generated_at::text
      FROM videos v
      LEFT JOIN video_seo vs ON vs.video_id = v.id
      WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
        ${filterSql} ${searchSql}
      ORDER BY coalesce(v.published_at, v.created_at) DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `);
    const [countRow] = await sqlRows<{ total: number }>(dsql`
      SELECT count(*)::int AS total
      FROM videos v
      LEFT JOIN video_seo vs ON vs.video_id = v.id
      WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
        ${filterSql} ${searchSql}
    `);

    const items: VideoSeoItem[] = rows.map((row) => ({
      videoId: row.video_id,
      slug: row.slug,
      title: row.title,
      publishedAt: row.published_at,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      keywords: row.keywords ?? [],
      source: row.source,
      aiModel: row.ai_model,
      generatedAt: row.generated_at,
    }));
    ok(res, paginated(items, Number(countRow?.total ?? 0), q.page, q.pageSize));
  }),
);

seoAdminRouter.post(
  '/keywords/run',
  validate({ body: z.object({ limit: z.coerce.number().int().min(1).max(1000).default(50) }) }),
  asyncHandler(async (req, res) => {
    const { limit } = body<{ limit: number }>(req);
    const result = await runSeoKeywordBatch(limit);
    await audit(req, 'seo.keywords.run', undefined, result);
    ok(res, result, `已处理 ${result.processed} 条`);
  }),
);

seoAdminRouter.post(
  '/keywords/:videoId/generate',
  validate({ params: z.object({ videoId: idSchema }) }),
  asyncHandler(async (req, res) => {
    const { videoId } = params<{ videoId: string }>(req);
    const result = await generateVideoSeo(videoId);
    ok(res, result, 'AI 已生成');
  }),
);

seoAdminRouter.put(
  '/keywords/:videoId',
  validate({ params: z.object({ videoId: idSchema }), body: videoSeoPatchSchema }),
  asyncHandler(async (req, res) => {
    const { videoId } = params<{ videoId: string }>(req);
    await patchVideoSeo(videoId, body(req));
    await audit(req, 'seo.keywords.update', { type: 'video', id: videoId });
    ok(res, null, '已保存');
  }),
);

// --------------------------------------------------------------------------
// 渲染预览：管理员检查爬虫看到的 HTML
// --------------------------------------------------------------------------

seoAdminRouter.get(
  '/render-preview',
  validate({ query: z.object({ path: z.string().min(1).max(300).default('/') }) }),
  asyncHandler(async (req, res) => {
    const { path } = query<{ path: string }>(req);
    const outcome = await renderForCrawler(path);
    ok(res, { status: outcome.status, html: outcome.html });
  }),
);
