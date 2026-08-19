import { describe, expect, it } from 'vitest';
import { settleRecommend } from '../apps/api/src/modules/catalog/fallback.ts';

describe('发现页推荐降级', () => {
  it('recommend 正常时 degraded=false 且带回推荐条', async () => {
    const rec = await settleRecommend(async () => [{ id: 'r1' }, { id: 'r2' }]);
    expect(rec.degraded).toBe(false);
    expect(rec.items.map((item) => item.id)).toEqual(['r1', 'r2']);
  });

  it('recommend 抛错时 degraded=true，items 空，不往外抛', async () => {
    const rec = await settleRecommend(async () => {
      throw new Error('recommend down');
    });
    expect(rec.degraded).toBe(true);
    expect(rec.items).toEqual([]);
  });

  it('降级后 latest / 7 日热门 / 分类精选仍可独立组装', async () => {
    const rec = await settleRecommend(async () => {
      throw new Error('recommend down');
    });
    const home = {
      recommend: rec.items,
      latest: [{ id: 'l1' }],
      hot7d: [{ id: 'h1' }],
      categories: [{ category: { id: 'c1', slug: 'travel', name: '旅行' }, items: [{ id: 'f1' }] }],
      degraded: rec.degraded,
    };
    expect(home.degraded).toBe(true);
    expect(home.recommend).toEqual([]);
    expect(home.latest).toHaveLength(1);
    expect(home.hot7d).toHaveLength(1);
    expect(home.categories[0]?.items).toHaveLength(1);
  });
});
