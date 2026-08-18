/**
 * 推荐排序的纯函数部分：候选构建、加权打分、MMR 多样性重排。
 *
 * 这里刻意不碰数据库与配置读取，全部输入靠参数传进来，
 * 既方便单测覆盖，也让「召回」与「排序」两个阶段的职责分开。
 */
import type { AlgoWeights } from '@videox/shared';

export interface Candidate {
  id: string;
  categoryId: string | null;
  authorId: string | null;
  tagIds: string[];
  affinity: number;
  quality: number;
  freshness: number;
  completion: number;
  popularity: number;
  aiScore: number;
  manualBoost: number;
  impressionPenalty: number;
  source: string;
  score: number;
}

export interface RecallRow {
  id: string;
  category_id: string | null;
  author_id: string | null;
  tag_ids: string[] | null;
  affinity: number;
  quality_score: number;
  age_days: number;
  completion_rate: number;
  view_count: number;
  ai_score: number | null;
  manual_boost: number;
  impressions: number;
  source: string;
}

/** 召回阶段各通路的 affinity 量纲不同，统一压到 0~1 再参与加权。 */
export function normalizeAffinity(rows: Pick<RecallRow, 'id' | 'affinity'>[]): Map<string, number> {
  const max = Math.max(1, ...rows.map((r) => Number(r.affinity)));
  return new Map(rows.map((r) => [r.id, Number(r.affinity) / max]));
}

export function score(candidate: Omit<Candidate, 'score'>, weights: AlgoWeights): number {
  return (
    candidate.affinity * weights.affinity +
    candidate.quality * weights.quality +
    candidate.freshness * weights.freshness +
    candidate.completion * weights.completion +
    candidate.popularity * weights.popularity +
    candidate.aiScore * weights.aiScore +
    candidate.manualBoost -
    candidate.impressionPenalty
  );
}

/** 把召回行折算成打过分的候选。 */
export function buildCandidates(rows: RecallRow[], weights: AlgoWeights): Candidate[] {
  const affinityMap = normalizeAffinity(rows);
  const maxViews = Math.max(1, ...rows.map((r) => Number(r.view_count)));

  return rows.map((row) => {
    const ageDays = Math.max(0, Number(row.age_days));
    const base = {
      id: row.id,
      categoryId: row.category_id,
      authorId: row.author_id,
      tagIds: row.tag_ids ?? [],
      affinity: affinityMap.get(row.id) ?? 0,
      quality: Math.min(1, Number(row.quality_score)),
      // 指数衰减：freshnessHalfLifeDays 天后新鲜度减半。
      freshness: Math.pow(0.5, ageDays / Math.max(0.1, weights.freshnessHalfLifeDays)),
      completion: Math.min(1, Number(row.completion_rate)),
      popularity: Math.log1p(Number(row.view_count)) / Math.log1p(maxViews),
      aiScore: row.ai_score !== null ? Number(row.ai_score) / 100 : 0,
      manualBoost: Number(row.manual_boost),
      // 曝光过 N 次仍未点击，线性降权，最多扣 0.5。
      impressionPenalty: Math.min(0.5, Number(row.impressions) * 0.08),
      source: row.source,
    };
    return { ...base, score: score(base, weights) };
  });
}

/**
 * 相似度近似：同分类 0.4 + 同作者 0.3 + 标签 Jaccard 0.3，上限 1。
 * 不追求语义精度，够用来把首屏拉开差异即可。
 */
export function similarity(a: Candidate, b: Candidate): number {
  let sim = 0;
  if (a.categoryId && a.categoryId === b.categoryId) sim += 0.4;
  if (a.authorId && a.authorId === b.authorId) sim += 0.3;

  if (a.tagIds.length > 0 && b.tagIds.length > 0) {
    const setB = new Set(b.tagIds);
    const intersection = a.tagIds.filter((id) => setB.has(id)).length;
    const union = new Set([...a.tagIds, ...b.tagIds]).size;
    sim += (intersection / union) * 0.3;
  }

  return Math.min(1, sim);
}

/**
 * MMR 重排：每次从剩余候选里挑「相关性高 且 与已选结果差异大」的一条。
 * 同作者/同分类另有硬上限，全部被挡住时退化为按分数取。
 */
export function mmrRerank(candidates: Candidate[], weights: AlgoWeights, limit: number): Candidate[] {
  const selected: Candidate[] = [];
  const pool = [...candidates].sort((a, b) => b.score - a.score);
  const authorCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();

  const maxScore = Math.max(1e-6, ...pool.map((c) => c.score));

  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i]!;

      const aCount = candidate.authorId ? (authorCount.get(candidate.authorId) ?? 0) : 0;
      const cCount = candidate.categoryId ? (categoryCount.get(candidate.categoryId) ?? 0) : 0;
      if (aCount >= weights.maxPerAuthor || cCount >= weights.maxPerCategory) continue;

      let maxSimilarity = 0;
      for (const chosen of selected) {
        maxSimilarity = Math.max(maxSimilarity, similarity(candidate, chosen));
      }

      const relevance = candidate.score / maxScore;
      const value = (1 - weights.diversityLambda) * relevance - weights.diversityLambda * maxSimilarity;

      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    if (bestValue === -Infinity) bestIndex = 0;

    const [picked] = pool.splice(bestIndex, 1);
    if (!picked) break;
    selected.push(picked);
    if (picked.authorId) authorCount.set(picked.authorId, (authorCount.get(picked.authorId) ?? 0) + 1);
    if (picked.categoryId) categoryCount.set(picked.categoryId, (categoryCount.get(picked.categoryId) ?? 0) + 1);
  }

  return selected;
}

/** 探索位：把尾部若干条换成未入选的候选，给冷启动内容曝光机会。 */
export function applyExploration(
  reranked: Candidate[],
  candidates: Candidate[],
  ratio: number,
  random: () => number = Math.random,
): Candidate[] {
  const exploreCount = Math.floor(reranked.length * ratio);
  if (exploreCount <= 0) return reranked;

  const result = [...reranked];
  const chosen = new Set(result.map((c) => c.id));
  const leftovers = candidates.filter((c) => !chosen.has(c.id));

  for (let i = 0; i < exploreCount && leftovers.length > 0; i += 1) {
    const pickIndex = Math.floor(random() * leftovers.length);
    const [pick] = leftovers.splice(pickIndex, 1);
    if (pick) result[result.length - 1 - i] = { ...pick, source: 'explore' };
  }

  return result;
}

export const SOURCE_LABELS: Record<string, string> = {
  tag: '根据你的兴趣标签',
  category: '你常看的分类',
  hot: '全站热门',
  fresh: '最新上架',
  collab: '相似用户也在看',
  anonymous: '热门推荐',
  explore: '为你发现',
};
