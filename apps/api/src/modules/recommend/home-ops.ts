import { desc, sql, type SQL } from 'drizzle-orm';
import type { TitleLang } from '@videox/shared';
import { db, t } from '../../core/db.js';

export type HomeKeywordDirection = 'boost' | 'penalty';

export interface HomeKeyword {
  keyword: string;
  direction: HomeKeywordDirection;
  weight: number;
}

/** 标题语种的升降权规则，一行一个语种。 */
export interface HomeLangRule {
  lang: TitleLang;
  direction: HomeKeywordDirection;
  weight: number;
}

/** 标题 / 简介 / 标签文本命中关键词时的加减分。 */
export function keywordScore(haystack: string, keywords: HomeKeyword[]): number {
  const text = haystack.toLowerCase();
  let score = 0;
  for (const item of keywords) {
    const needle = item.keyword.trim().toLowerCase();
    if (!needle) continue;
    if (!text.includes(needle)) continue;
    score += item.direction === 'boost' ? item.weight : -item.weight;
  }
  return score;
}

/** 运营置顶永远排在默认推荐前面，并去掉后面的重复项。 */
export function prependPins<T extends { id: string }>(pins: T[], items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const pin of pins) {
    if (seen.has(pin.id)) continue;
    seen.add(pin.id);
    out.push(pin);
  }
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function normalizeHomeKeyword(raw: string): string {
  return raw.trim().replace(/[%_]/g, '').slice(0, 80);
}

export function homeKeywordScoreSql(): SQL {
  return sql`COALESCE((
    SELECT SUM(CASE WHEN k.direction = 'boost' THEN k.weight ELSE -k.weight END)
    FROM home_recommend_keywords k
    WHERE length(btrim(k.keyword)) > 0
      AND (
        ${t.videos.title} ILIKE '%' || k.keyword || '%'
        OR COALESCE(${t.videos.description}, '') ILIKE '%' || k.keyword || '%'
        OR EXISTS (
          SELECT 1 FROM video_tags vt
          JOIN tags tg ON tg.id = vt.tag_id
          WHERE vt.video_id = ${t.videos.id}
            AND (tg.name ILIKE '%' || k.keyword || '%' OR tg.slug ILIKE '%' || k.keyword || '%')
        )
      )
  ), 0)`;
}

export function homeRecommendedOrderBy(): SQL[] {
  return [
    sql`CASE WHEN ${t.homeRecommendPins.videoId} IS NOT NULL THEN 0 ELSE 1 END ASC`,
    sql`${t.homeRecommendPins.sortOrder} ASC NULLS LAST`,
    sql`${homeKeywordScoreSql()} DESC`,
    // 语种权重排在关键词之后、时间之前：运营点名要推的词优先于语种偏好，
    // 同语种 / 同命中下的先后仍然交给新鲜度决定。
    sql`${homeLangScoreSql()} DESC`,
    desc(sql`coalesce(${t.videos.publishedAt}, ${t.videos.createdAt})`),
  ];
}

/**
 * 标题语种命中时的加减分。
 *
 * 语种用等值命中 videos.title_lang，不再现算——按行跑一串中文/日文/韩文正则会
 * 把首页那条查询从 300ms 拉到 2.2s 量级（线上 EXPLAIN ANALYZE 实测），
 * 而语种在写入时就由 detectTitleLang 定好并存下来了。
 */
export function homeLangScoreSql(): SQL {
  return sql`COALESCE((
    SELECT SUM(CASE WHEN r.direction = 'boost' THEN r.weight ELSE -r.weight END)
    FROM home_recommend_lang_rules r
    WHERE r.lang = ${t.videos.titleLang}
  ), 0)`;
}

/** 纯函数版：给单条视频算语种分，测试与后台预览用。 */
export function langRuleScore(lang: string | null | undefined, rules: HomeLangRule[]): number {
  if (!lang) return 0;
  let score = 0;
  for (const rule of rules) {
    if (rule.lang !== lang) continue;
    score += rule.direction === 'boost' ? rule.weight : -rule.weight;
  }
  return score;
}

export async function listHomeKeywords(): Promise<HomeKeyword[]> {
  const rows = await db
    .select({
      keyword: t.homeRecommendKeywords.keyword,
      direction: t.homeRecommendKeywords.direction,
      weight: t.homeRecommendKeywords.weight,
    })
    .from(t.homeRecommendKeywords);
  return rows.map((row) => ({
    keyword: row.keyword,
    direction: row.direction,
    weight: Number(row.weight),
  }));
}

export async function listHomeLangRules(): Promise<HomeLangRule[]> {
  const rows = await db
    .select({
      lang: t.homeRecommendLangRules.lang,
      direction: t.homeRecommendLangRules.direction,
      weight: t.homeRecommendLangRules.weight,
    })
    .from(t.homeRecommendLangRules);
  return rows.map((row) => ({
    lang: row.lang,
    direction: row.direction,
    weight: Number(row.weight),
  }));
}
