import { describe, expect, it } from 'vitest';
import {
  describeFullCrawlPlan,
  fullCrawlBatchIndex,
  nextFullCrawlDelayMs,
  planFullCrawl,
} from '@videox/shared';

describe('手动全量抓取分批', () => {
  it('2755 页、每批 140 页会自动分成 20 批', () => {
    const plan = planFullCrawl({ endPage: 2755, pagesPerBatch: 140, batchIntervalSeconds: 60 });
    expect(plan).toMatchObject({
      endPage: 2755,
      pagesPerBatch: 140,
      batchIntervalSeconds: 60,
      batchCount: 20,
      lastBatchPages: 95,
    });
    expect(describeFullCrawlPlan(plan)).toContain('20 批');
    expect(describeFullCrawlPlan(plan)).toContain('最后一批 95 页');
  });

  it('兼容旧的 maxPages 字段', () => {
    expect(planFullCrawl({ maxPages: 200 }).endPage).toBe(200);
  });

  it('一批末尾才使用批次间隔，页间仍是 0.5 秒', () => {
    const plan = planFullCrawl({ endPage: 2755, pagesPerBatch: 140, batchIntervalSeconds: 90 });
    expect(nextFullCrawlDelayMs(139, plan)).toBe(500);
    expect(nextFullCrawlDelayMs(140, plan)).toBe(90_000);
    expect(nextFullCrawlDelayMs(2660, plan)).toBe(90_000);
    expect(fullCrawlBatchIndex(141, 140)).toBe(2);
    expect(fullCrawlBatchIndex(2755, 140)).toBe(20);
  });
});
