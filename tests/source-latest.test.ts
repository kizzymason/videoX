import { describe, expect, it } from 'vitest';
import { compareSourceLatest, type SourceLatestKey } from '../apps/api/src/modules/videos/source-latest.ts';
import { WATCH_HISTORY_LIMIT } from '@videox/shared';

const key = (partial: SourceLatestKey): SourceLatestKey => partial;

describe('最新排序对齐源站', () => {
  it('第 1 页排在第 2 页前面', () => {
    const page1 = key({ collectedPage: 1, collectedAtMs: 2000, publishedAtMs: 1 });
    const page2 = key({ collectedPage: 2, collectedAtMs: 1000, publishedAtMs: 9 });
    expect(compareSourceLatest(page1, page2)).toBeLessThan(0);
  });

  it('同一页内按采集写入顺序（源站列表顺序）', () => {
    const first = key({ collectedPage: 1, collectedAtMs: 100, publishedAtMs: 1 });
    const second = key({ collectedPage: 1, collectedAtMs: 200, publishedAtMs: 9 });
    expect(compareSourceLatest(first, second)).toBeLessThan(0);
  });

  it('本地上传排在采集片前面，并按发布时间倒序', () => {
    const localNew = key({ collectedPage: null, collectedAtMs: null, publishedAtMs: 90 });
    const localOld = key({ collectedPage: null, collectedAtMs: null, publishedAtMs: 10 });
    const collected = key({ collectedPage: 1, collectedAtMs: 1, publishedAtMs: 1000 });
    const ordered = [collected, localOld, localNew].sort(compareSourceLatest);
    expect(ordered).toEqual([localNew, localOld, collected]);
  });

  it('整表排序后是 1 页→高页，不是导入时间倒序', () => {
    const items = [
      key({ collectedPage: 2775, collectedAtMs: 9000, publishedAtMs: 9000 }),
      key({ collectedPage: 1, collectedAtMs: 20, publishedAtMs: 100 }),
      key({ collectedPage: 1, collectedAtMs: 10, publishedAtMs: 200 }),
      key({ collectedPage: 2, collectedAtMs: 30, publishedAtMs: 8000 }),
    ];
    const ordered = [...items].sort(compareSourceLatest);
    expect(ordered.map((item) => `${item.collectedPage}:${item.collectedAtMs}`)).toEqual([
      '1:10',
      '1:20',
      '2:30',
      '2775:9000',
    ]);
  });
});

describe('观看历史上限', () => {
  it('每用户只保留 20 条', () => {
    expect(WATCH_HISTORY_LIMIT).toBe(20);
  });
});
