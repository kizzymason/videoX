// ========================================================================
// SEO 系统 - AI 关键词优化
//
// 用 OpenAI 兼容接口为已发布视频自动生成 SEO 标题 / 描述 / 关键词，
// 写入 video_seo 表。爬虫渲染、sitemap、meta 接口统一读这份数据，
// 保证页面与 sitemap 元数据一致（搜索引擎富媒体结果的硬要求）。
// ========================================================================

import { desc, eq, sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { db, t, sqlRows } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { chatCompletion, type LlmMessage } from '../collection/ai/llm.js';
import { getSeoSettings } from './settings.js';
import { getSiteSettings } from '../settings/service.js';

export interface SeoAiResult {
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
}

const aiResultSchema = z.object({
  title: z.string().min(1).max(400),
  description: z.string().min(1).max(1000),
  keywords: z.array(z.string().min(1).max(120)).min(1).max(30),
});

export interface SeoPromptInput {
  title: string;
  description: string | null;
  categoryName: string | null;
  tags: string[];
  siteName: string;
  siteKeywords: string;
  siteContext: string;
}

export function buildSeoPrompt(input: SeoPromptInput): LlmMessage[] {
  const context = [
    `站点名称：${input.siteName}`,
    input.siteKeywords ? `站点关键词：${input.siteKeywords}` : '',
    input.siteContext ? `站点定位：${input.siteContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const video = [
    `视频标题：${input.title}`,
    input.categoryName ? `所属频道：${input.categoryName}` : '',
    input.tags.length > 0 ? `已有标签：${input.tags.join('、')}` : '',
    input.description ? `视频简介：${input.description.slice(0, 500)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        '你是资深中文 SEO 专家，为视频网站的播放页生成搜索引擎优化元数据。' +
        '要求：1) SEO 标题在保留原始标题核心信息的基础上补充高搜索量词，不超过 60 个字符；' +
        '2) 描述 80-150 个字符，自然通顺、包含核心关键词、能吸引点击，不要堆砌；' +
        '3) 关键词 5-10 个，覆盖核心词 + 长尾词，按重要性排序；' +
        '4) 不得编造视频中不存在的内容。' +
        '只输出 JSON，格式：{"title":"...","description":"...","keywords":["...", "..."]}',
    },
    {
      role: 'user',
      content: `${context}\n\n${video}\n\n请生成 SEO 元数据 JSON。`,
    },
  ];
}

/**
 * 解析模型输出：容忍 markdown 代码块包裹与前后闲话，抽出第一个 JSON 对象。
 * 长度超限时截断而不是报错，关键词去重、去空。
 */
export function parseSeoAiResponse(content: string): SeoAiResult {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI 输出中没有找到 JSON 对象');

  const parsed = aiResultSchema.parse(JSON.parse(stripped.slice(start, end + 1)));
  const keywords: string[] = [];
  for (const raw of parsed.keywords) {
    const keyword = raw.trim().slice(0, 60);
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
    if (keywords.length >= 12) break;
  }
  return {
    seoTitle: parsed.title.trim().slice(0, 200),
    seoDescription: parsed.description.trim().slice(0, 500),
    keywords,
  };
}

interface VideoForSeo {
  id: string;
  title: string;
  description: string | null;
  category_name: string | null;
}

async function loadVideoForSeo(videoId: string): Promise<{ video: VideoForSeo; tags: string[] } | null> {
  const rows = await sqlRows<VideoForSeo>(dsql`
    SELECT v.id, v.title, v.description, c.name AS category_name
    FROM videos v
    LEFT JOIN categories c ON c.id = v.category_id
    WHERE v.id = ${videoId}
    LIMIT 1
  `);
  const video = rows[0];
  if (!video) return null;
  const tagRows = await sqlRows<{ name: string }>(dsql`
    SELECT t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id = ${videoId} LIMIT 20
  `);
  return { video, tags: tagRows.map((r) => r.name) };
}

/** 为单个视频生成并保存 SEO 元数据。 */
export async function generateVideoSeo(videoId: string): Promise<SeoAiResult> {
  const seoSettings = await getSeoSettings();
  if (!seoSettings.ai.enabled || !seoSettings.ai.endpoint || !seoSettings.ai.model) {
    throw new Error('AI 关键词优化未启用或未配置接口');
  }

  const loaded = await loadVideoForSeo(videoId);
  if (!loaded) throw new Error('视频不存在');

  const siteSettings = await getSiteSettings();
  const messages = buildSeoPrompt({
    title: loaded.video.title,
    description: loaded.video.description,
    categoryName: loaded.video.category_name,
    tags: loaded.tags,
    siteName: siteSettings.siteName,
    siteKeywords: siteSettings.siteKeywords,
    siteContext: seoSettings.ai.siteContext,
  });

  const completion = await chatCompletion({
    endpoint: seoSettings.ai.endpoint,
    apiKey: seoSettings.ai.apiKey,
    model: seoSettings.ai.model,
    temperature: seoSettings.ai.temperature,
    messages,
    timeoutMs: 60_000,
  });

  const result = parseSeoAiResponse(completion.content);
  const now = new Date();
  await db
    .insert(t.videoSeo)
    .values({
      videoId,
      seoTitle: result.seoTitle,
      seoDescription: result.seoDescription,
      keywords: result.keywords,
      source: 'ai',
      aiModel: seoSettings.ai.model,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: t.videoSeo.videoId,
      set: {
        seoTitle: result.seoTitle,
        seoDescription: result.seoDescription,
        keywords: result.keywords,
        source: 'ai',
        aiModel: seoSettings.ai.model,
        generatedAt: now,
        updatedAt: now,
      },
    });

  return result;
}

/**
 * 批量补齐：给还没生成过 SEO 元数据的已发布视频跑 AI，新→旧串行执行。
 * 单条失败不影响其余，返回成功/失败计数。
 */
export async function runSeoKeywordBatch(limit: number): Promise<{ processed: number; succeeded: number; failed: number }> {
  const rows = await sqlRows<{ id: string }>(dsql`
    SELECT v.id FROM videos v
    LEFT JOIN video_seo vs ON vs.video_id = v.id
    WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
      AND vs.video_id IS NULL
    ORDER BY coalesce(v.published_at, v.created_at) DESC
    LIMIT ${limit}
  `);

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await generateVideoSeo(row.id);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, videoId: row.id }, 'AI 生成视频 SEO 失败，跳过');
    }
  }

  if (rows.length > 0) logger.info({ processed: rows.length, succeeded, failed }, 'SEO 关键词批量生成完成');
  return { processed: rows.length, succeeded, failed };
}

/** 人工维护单个视频的 SEO 元数据。 */
export async function patchVideoSeo(
  videoId: string,
  patch: { seoTitle?: string | null; seoDescription?: string | null; keywords?: string[] },
): Promise<void> {
  const now = new Date();
  const existing = await db.select().from(t.videoSeo).where(eq(t.videoSeo.videoId, videoId)).limit(1);
  if (existing.length === 0) {
    await db.insert(t.videoSeo).values({
      videoId,
      seoTitle: patch.seoTitle ?? null,
      seoDescription: patch.seoDescription ?? null,
      keywords: patch.keywords ?? [],
      source: 'manual',
      generatedAt: now,
    });
    return;
  }
  await db
    .update(t.videoSeo)
    .set({
      ...(patch.seoTitle !== undefined ? { seoTitle: patch.seoTitle } : {}),
      ...(patch.seoDescription !== undefined ? { seoDescription: patch.seoDescription } : {}),
      ...(patch.keywords !== undefined ? { keywords: patch.keywords } : {}),
      source: 'manual',
      updatedAt: now,
    })
    .where(eq(t.videoSeo.videoId, videoId));
}
