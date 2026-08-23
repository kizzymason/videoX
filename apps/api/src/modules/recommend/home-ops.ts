import { desc, sql, type SQL } from 'drizzle-orm';
import { db, t } from '../../core/db.js';

export type HomeKeywordDirection = 'boost' | 'penalty';

export interface HomeKeyword {
  keyword: string;
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
    desc(sql`coalesce(${t.videos.publishedAt}, ${t.videos.createdAt})`),
  ];
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
