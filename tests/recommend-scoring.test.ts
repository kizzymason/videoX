import { describe, expect, it } from 'vitest';
import type { AlgoWeights } from '@videox/shared';
import {
  applyExploration,
  buildCandidates,
  mmrRerank,
  normalizeAffinity,
  score,
  similarity,
  type Candidate,
  type RecallRow,
} from '../apps/api/src/modules/recommend/scoring.js';

const WEIGHTS: AlgoWeights = {
  affinity: 1,
  quality: 1,
  freshness: 1,
  completion: 1,
  popularity: 1,
  aiScore: 1,
  affinityHalfLifeDays: 14,
  freshnessHalfLifeDays: 7,
  diversityLambda: 0.3,
  maxPerAuthor: 2,
  maxPerCategory: 3,
  explorationRatio: 0,
};

const row = (over: Partial<RecallRow> = {}): RecallRow => ({
  id: 'v1',
  category_id: 'c1',
  author_id: 'a1',
  tag_ids: [],
  affinity: 0,
  quality_score: 0,
  age_days: 0,
  completion_rate: 0,
  view_count: 0,
  ai_score: null,
  manual_boost: 0,
  impressions: 0,
  source: 'hot',
  ...over,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'v1',
  categoryId: 'c1',
  authorId: 'a1',
  tagIds: [],
  affinity: 0,
  quality: 0,
  freshness: 0,
  completion: 0,
  popularity: 0,
  aiScore: 0,
  manualBoost: 0,
  impressionPenalty: 0,
  source: 'hot',
  score: 0,
  ...over,
});

describe('score 加权求和', () => {
  it('每个信号都按各自权重线性叠加', () => {
    const c = candidate({ affinity: 1, quality: 0.5, freshness: 0.25, completion: 0.1 });
    const weights = { ...WEIGHTS, affinity: 2, quality: 4, freshness: 8, completion: 10 };

    expect(score(c, weights)).toBeCloseTo(2 + 2 + 2 + 1, 6);
  });

  it('人工加权是加分项，曝光惩罚是减分项', () => {
    const zeroWeights = { ...WEIGHTS, affinity: 0, quality: 0, freshness: 0, completion: 0, popularity: 0, aiScore: 0 };

    expect(score(candidate({ manualBoost: 0.4 }), zeroWeights)).toBeCloseTo(0.4, 6);
    expect(score(candidate({ impressionPenalty: 0.3 }), zeroWeights)).toBeCloseTo(-0.3, 6);
  });

  it('把某个权重调成 0，对应信号就完全不参与排序', () => {
    const c = candidate({ affinity: 1 });
    expect(score(c, { ...WEIGHTS, affinity: 0 })).toBe(0);
  });
});

describe('normalizeAffinity 归一化', () => {
  it('按当批最大值压到 0~1', () => {
    const map = normalizeAffinity([
      { id: 'a', affinity: 10 },
      { id: 'b', affinity: 5 },
      { id: 'c', affinity: 0 },
    ]);

    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(0.5);
    expect(map.get('c')).toBe(0);
  });

  it('全为 0 时不会除零', () => {
    const map = normalizeAffinity([{ id: 'a', affinity: 0 }]);
    expect(map.get('a')).toBe(0);
  });
});

describe('buildCandidates 特征折算', () => {
  it('新鲜度按半衰期指数衰减：刚发布是 1，一个半衰期后是 0.5', () => {
    const [fresh, aged] = buildCandidates([row({ id: 'new', age_days: 0 }), row({ id: 'old', age_days: 7 })], WEIGHTS);

    expect(fresh!.freshness).toBeCloseTo(1, 6);
    expect(aged!.freshness).toBeCloseTo(0.5, 6);
  });

  it('热度取对数再按当批最大值归一，避免头部内容碾压全场', () => {
    const [big, small] = buildCandidates(
      [row({ id: 'big', view_count: 1_000_000 }), row({ id: 'small', view_count: 1_000 })],
      WEIGHTS,
    );

    expect(big!.popularity).toBeCloseTo(1, 6);
    // 播放量差 1000 倍，热度分只差约一半
    expect(small!.popularity).toBeGreaterThan(0.4);
    expect(small!.popularity).toBeLessThan(0.6);
  });

  it('AI 打分是百分制，折算到 0~1；没有打分时按 0 处理而不是拖累排序', () => {
    const [scored, unscored] = buildCandidates(
      [row({ id: 'scored', ai_score: 80 }), row({ id: 'unscored', ai_score: null })],
      WEIGHTS,
    );

    expect(scored!.aiScore).toBeCloseTo(0.8, 6);
    expect(unscored!.aiScore).toBe(0);
  });

  it('曝光惩罚线性增长但封顶 0.5，反复曝光不会把内容永久打死', () => {
    const [once, many] = buildCandidates([row({ id: 'once', impressions: 1 }), row({ id: 'many', impressions: 99 })], WEIGHTS);

    expect(once!.impressionPenalty).toBeCloseTo(0.08, 6);
    expect(many!.impressionPenalty).toBe(0.5);
  });

  it('质量分与完播率都被夹在 1 以内，脏数据不会溢出', () => {
    const [c] = buildCandidates([row({ quality_score: 3, completion_rate: 2 })], WEIGHTS);
    expect(c!.quality).toBe(1);
    expect(c!.completion).toBe(1);
  });

  it('空召回返回空候选', () => {
    expect(buildCandidates([], WEIGHTS)).toEqual([]);
  });
});

describe('similarity 相似度', () => {
  it('同分类 0.4、同作者 0.3，两者叠加 0.7', () => {
    const a = candidate({ id: 'a' });
    expect(similarity(a, candidate({ id: 'b', authorId: 'a2' }))).toBeCloseTo(0.4, 6);
    expect(similarity(a, candidate({ id: 'b', categoryId: 'c2' }))).toBeCloseTo(0.3, 6);
    expect(similarity(a, candidate({ id: 'b' }))).toBeCloseTo(0.7, 6);
  });

  it('标签按 Jaccard 计入，最多再加 0.3', () => {
    const a = candidate({ categoryId: null, authorId: null, tagIds: ['t1', 't2'] });
    const identical = candidate({ categoryId: null, authorId: null, tagIds: ['t1', 't2'] });
    const half = candidate({ categoryId: null, authorId: null, tagIds: ['t1', 't3'] });

    expect(similarity(a, identical)).toBeCloseTo(0.3, 6);
    // 交集 1 / 并集 3
    expect(similarity(a, half)).toBeCloseTo(0.1, 6);
  });

  it('毫无共同点时为 0，完全一致时不超过 1', () => {
    const a = candidate({ categoryId: 'c1', authorId: 'a1', tagIds: ['t1'] });
    expect(similarity(a, candidate({ categoryId: 'c2', authorId: 'a2', tagIds: ['t9'] }))).toBe(0);
    expect(similarity(a, { ...a })).toBeLessThanOrEqual(1);
  });
});

describe('mmrRerank 多样性重排', () => {
  it('lambda=0 时退化为纯按分数排序', () => {
    const candidates = [
      candidate({ id: 'low', score: 1 }),
      candidate({ id: 'high', score: 9 }),
      candidate({ id: 'mid', score: 5 }),
    ];

    const out = mmrRerank(candidates, { ...WEIGHTS, diversityLambda: 0, maxPerAuthor: 99, maxPerCategory: 99 }, 3);
    expect(out.map((c) => c.id)).toEqual(['high', 'mid', 'low']);
  });

  it('高 lambda 会把分数略低但更不同的内容提前', () => {
    const candidates = [
      candidate({ id: 'top', score: 10, categoryId: 'c1', authorId: 'a1', tagIds: ['t1'] }),
      candidate({ id: 'clone', score: 9.5, categoryId: 'c1', authorId: 'a1', tagIds: ['t1'] }),
      candidate({ id: 'different', score: 8, categoryId: 'c2', authorId: 'a2', tagIds: ['t9'] }),
    ];

    const weights = { ...WEIGHTS, diversityLambda: 0.7, maxPerAuthor: 99, maxPerCategory: 99 };
    const out = mmrRerank(candidates, weights, 3);

    expect(out[0]!.id).toBe('top');
    expect(out[1]!.id).toBe('different');
    expect(out[2]!.id).toBe('clone');
  });

  it('一个刷屏作者最多占 maxPerAuthor 个坑，即便它包揽了分数前几名', () => {
    // 前 4 条都是同一个作者且分数最高，后 4 条各不相同
    const candidates = Array.from({ length: 8 }, (_, i) =>
      candidate({ id: `v${i}`, score: 10 - i, authorId: i < 4 ? 'spammer' : `a${i}`, categoryId: `c${i}` }),
    );

    const out = mmrRerank(candidates, { ...WEIGHTS, maxPerAuthor: 2, maxPerCategory: 99 }, 4);
    expect(out).toHaveLength(4);
    expect(out.filter((c) => c.authorId === 'spammer')).toHaveLength(2);
  });

  it('同分类数量不超过 maxPerCategory', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `v${i}`, score: 10 - i, authorId: `a${i}`, categoryId: i < 6 ? 'c1' : `c${i}` }),
    );

    const out = mmrRerank(candidates, { ...WEIGHTS, maxPerAuthor: 99, maxPerCategory: 3 }, 5);
    expect(out).toHaveLength(5);
    expect(out.filter((c) => c.categoryId === 'c1')).toHaveLength(3);
  });

  it('候选不够时宁可放宽硬约束也要凑满一屏，而不是返回半页', () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ id: `v${i}`, score: 10 - i, authorId: 'only', categoryId: 'c1' }),
    );

    const out = mmrRerank(candidates, { ...WEIGHTS, maxPerAuthor: 1, maxPerCategory: 1 }, 3);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).toEqual(['v0', 'v1', 'v2']);
  });

  it('limit 大于候选数时全量返回且不重复', () => {
    const candidates = [candidate({ id: 'a', authorId: 'a1', categoryId: 'c1' }), candidate({ id: 'b', authorId: 'a2', categoryId: 'c2' })];
    const out = mmrRerank(candidates, WEIGHTS, 50);

    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
  });

  it('不修改传入的候选数组', () => {
    const candidates = [candidate({ id: 'a', score: 1 }), candidate({ id: 'b', score: 2 })];
    mmrRerank(candidates, WEIGHTS, 2);
    expect(candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('applyExploration 探索位', () => {
  const ranked = Array.from({ length: 10 }, (_, i) => candidate({ id: `r${i}` }));
  const pool = [...ranked, candidate({ id: 'cold-1' }), candidate({ id: 'cold-2' })];

  it('比例为 0 时原样返回', () => {
    expect(applyExploration(ranked, pool, 0)).toBe(ranked);
  });

  it('按比例替换列表尾部，且标记来源为 explore', () => {
    const out = applyExploration(ranked, pool, 0.2, () => 0);

    expect(out).toHaveLength(10);
    expect(out.slice(0, 8).map((c) => c.id)).toEqual(ranked.slice(0, 8).map((c) => c.id));
    expect(out[9]!.id).toBe('cold-1');
    expect(out[8]!.id).toBe('cold-2');
    expect(out.slice(8).every((c) => c.source === 'explore')).toBe(true);
  });

  it('只会从未入选的候选里取，不会造成重复', () => {
    const out = applyExploration(ranked, pool, 0.3, () => 0);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
  });

  it('没有多余候选可换时保持原列表长度', () => {
    const out = applyExploration(ranked, ranked, 0.5, () => 0);
    expect(out).toHaveLength(10);
    expect(out.map((c) => c.id)).toEqual(ranked.map((c) => c.id));
  });

  it('不修改传入的已排序数组', () => {
    applyExploration(ranked, pool, 0.2, () => 0);
    expect(ranked[9]!.id).toBe('r9');
  });
});

describe('端到端排序管线', () => {
  it('兴趣命中 + 高质量 + 新内容的组合排在最前', () => {
    const rows = [
      row({ id: 'perfect', affinity: 10, quality_score: 0.9, age_days: 0, completion_rate: 0.8, view_count: 5000, category_id: 'c1', author_id: 'a1' }),
      row({ id: 'stale', affinity: 1, quality_score: 0.2, age_days: 90, completion_rate: 0.1, view_count: 100, category_id: 'c2', author_id: 'a2' }),
      row({ id: 'buried', affinity: 0, quality_score: 0.1, age_days: 200, impressions: 20, category_id: 'c3', author_id: 'a3' }),
    ];

    const candidates = buildCandidates(rows, WEIGHTS);
    const out = mmrRerank(candidates, { ...WEIGHTS, diversityLambda: 0.2 }, 3);

    expect(out[0]!.id).toBe('perfect');
    expect(out[2]!.id).toBe('buried');
  });

  it('调高 aiScore 权重可以让 AI 看好的内容翻盘', () => {
    const rows = [
      row({ id: 'popular', view_count: 100_000, ai_score: 10, category_id: 'c1', author_id: 'a1' }),
      row({ id: 'ai-pick', view_count: 10, ai_score: 100, category_id: 'c2', author_id: 'a2' }),
    ];

    const lowAi = mmrRerank(buildCandidates(rows, { ...WEIGHTS, aiScore: 0 }), { ...WEIGHTS, aiScore: 0, diversityLambda: 0 }, 2);
    expect(lowAi[0]!.id).toBe('popular');

    const highAi = { ...WEIGHTS, aiScore: 10, diversityLambda: 0 };
    const boosted = mmrRerank(buildCandidates(rows, highAi), highAi, 2);
    expect(boosted[0]!.id).toBe('ai-pick');
  });
});
