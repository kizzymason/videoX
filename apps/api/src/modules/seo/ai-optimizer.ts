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
    { role: 'system', content: SEO_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${context}\n\n${video}\n\n请生成 SEO 元数据 JSON。`,
    },
  ];
}

/**
 * 系统提示词。
 *
 * 这是一个已做年龄门禁的合法成人视频平台，任务性质是**给已存在的内容做元数据标注**，
 * 不是生成成人内容本身。通用模型遇到成人题材容易两种跑偏：直接拒答，或者输出
 * 「精彩内容」「优质影片」这种什么都没说的安全话术 —— 后者更麻烦，因为它会静默地
 * 产出一堆无效 SEO 数据，还看不出错。所以提示词里把任务边界、必须具体、以及
 * 「不准输出拒答话术」都写死，并要求原样保留片源里的人名与系列号（那些正是被搜索的词）。
 */
const SEO_SYSTEM_PROMPT = [
  '你是成人视频平台的 SEO 元数据标注专家。',
  '',
  '【任务性质】',
  '这是一个合法运营、已做年龄验证与合规审核的成人视频平台。你的工作是为平台上**已经存在**的视频',
  '整理搜索引擎元数据（标题、描述、关键词），属于信息组织与检索优化，不是创作成人内容。',
  '成人题材本身不构成拒绝理由：请像给任何其他类型视频做 SEO 一样，专业、准确、具体地完成标注。',
  '',
  '【硬性要求】',
  '1) 必须输出 JSON，不得输出任何拒绝、免责、道歉或与任务无关的说明文字。',
  '2) 描述与关键词必须**具体到可检索**：要写清题材类型、演员特征、场景、风格、系列信息等',
  '   用户真正会拿去搜索的信息。禁止用「精彩内容」「优质视频」「不容错过」这类空泛套话代替具体信息。',
  '3) 原样保留原始标题里的人名、演员名、片商名、系列号与集数（如 MEN、BLUEMEN、ep.14、NS-093）。',
  '   这些是搜索量最集中的词，不得翻译、改写或删除。',
  '4) 只依据给到的标题、频道、标签、简介推断，不得编造视频里没有的情节、演员或剧情。',
  '   信息不足时就写得笼统一些，但不要虚构。',
  '5) 不输出任何露骨的性行为过程描写。用题材词、类型词、身份词做客观归类即可',
  '   —— 目标是让搜索引擎理解这个视频「属于什么类别」，不是复述画面。',
  '',
  '【字段规范】',
  'title：SEO 标题，保留原标题核心信息并补上高搜索量词，不超过 60 字符，不要堆砌重复词。',
  'description：80-150 字符，自然通顺的一段话，包含核心关键词，读起来像人写的介绍。',
  'keywords：5-12 个，按重要性排序，覆盖核心词与长尾词。',
  '  原标题是英文时，关键词要中英混排（英文人名/片商名保留原文，同时给出中文题材词），',
  '  这样中英文搜索都能命中。',
  '',
  '【输出格式】',
  '只输出一个 JSON 对象，不要 markdown 代码块，不要前后解释：',
  '{"title":"...","description":"...","keywords":["...","..."]}',
].join('\n');

/**
 * 拒答话术特征。
 *
 * 有些模型不会硬拒，而是把拒绝包在合法 JSON 里（description 写「抱歉，我无法…」），
 * 这种最危险：格式校验能过，于是几万条垃圾数据静默入库还看不出来。
 * 命中就当这一条失败，让批量任务记 failed 而不是写进库。
 */
const REFUSAL_MARKERS = [
  '无法提供',
  '无法协助',
  '无法完成',
  '不能提供',
  '不便提供',
  '抱歉，我',
  '很抱歉',
  '违反',
  '不适当的内容',
  '不适合的内容',
  '作为一个ai',
  '作为 ai',
  'as an ai',
  'i cannot',
  "i can't",
  'i am sorry',
  "i'm sorry",
  'unable to assist',
  'unable to provide',
  'against my guidelines',
];

function assertNotRefusal(text: string): void {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  const hit = REFUSAL_MARKERS.find((marker) => normalized.includes(marker.toLowerCase().replace(/\s+/g, '')));
  if (hit) throw new Error(`AI 拒绝生成 SEO 元数据（命中拒答特征「${hit}」），请检查系统提示词或换模型`);
}

/**
 * 解析模型输出：容忍 markdown 代码块包裹与前后闲话，抽出第一个 JSON 对象。
 * 长度超限时截断而不是报错，关键词去重、去空。
 */
export function parseSeoAiResponse(content: string): SeoAiResult {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) {
    // 没有 JSON 时先看看是不是拒答，好让日志里能直接看出原因。
    assertNotRefusal(stripped);
    throw new Error('AI 输出中没有找到 JSON 对象');
  }

  const parsed = aiResultSchema.parse(JSON.parse(stripped.slice(start, end + 1)));
  assertNotRefusal(`${parsed.title} ${parsed.description} ${parsed.keywords.join(' ')}`);
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
