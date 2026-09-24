import { describe, expect, it } from 'vitest';
import {
  compareSourceLatest,
  localRecencyOf,
  numericExternalId,
  type SourceLatestKey,
} from '../apps/api/src/modules/videos/source-latest.ts';
import { WATCH_HISTORY_LIMIT } from '@videox/shared';

/**
 * 线上实测对照（2026-09-25，源站 gv `sort=latest` 第 1 页，page_size=36）：
 *
 *   1000009681, 1000009680, 1000009677, 1000009676, 1000009675, 1000009672,
 *   1000009664, 1000009661, 1000009660, 1000009659, 1000009658, 1000009655,
 *   1000009649, 1000009648, 1000009591, 1000009559, 1000009556, 1000009534,
 *   1000009519, 1000009509, 1000009497, 1000009493, 1000009465, 1000009464, ...
 *
 * 前 24 条严格按视频号递减，所以「最新 = 源站视频号倒序」。
 * 另实测：封面文件名里的时间戳与视频号相关性只有 0.23，不能当排序键，故弃用。
 */
const key = (partial: Partial<SourceLatestKey> & { videoId: string }): SourceLatestKey => ({
  externalId: null,
  publishedAtMs: null,
  createdAtMs: 0,
  ...partial,
});

describe('最新排序对齐源站', () => {
  it('源站第 1 页那段就是视频号递减', () => {
    // 取实测真值的前 8 个号
    const ids = [1000009681, 1000009680, 1000009677, 1000009676, 1000009675, 1000009672, 1000009664, 1000009661];
    const items = ids.map((id, index) => key({ videoId: `v${index}`, externalId: String(id) }));
    // 打乱后排序，必须还原成源站顺序
    const shuffled = [items[5]!, items[2]!, items[7]!, items[0]!, items[4]!, items[1]!, items[6]!, items[3]!];
    expect([...shuffled].sort(compareSourceLatest).map((item) => Number(item.externalId))).toEqual(ids);
  });

  it('回归：采集时最早的旧片不再因为「页码 1 + 入库早」被顶到最前', () => {
    // 09-07 那批最旧的内容，编号也小
    const staleOld = key({ videoId: 'old', externalId: '1000005626', createdAtMs: 1_700_000_000_000 });
    const freshNew = key({ videoId: 'new', externalId: '1000009452', createdAtMs: 1_790_270_000_000 });
    expect([staleOld, freshNew].sort(compareSourceLatest)[0]!.videoId).toBe('new');
  });

  it('采集时间与源站号冲突时以源站号为准', () => {
    // 号大但入库早（重新采集过的老片）依然排前面；号小但入库晚的不能插队
    const highId = key({ videoId: 'hi', externalId: '1000009452', createdAtMs: 1 });
    const lowId = key({ videoId: 'lo', externalId: '1000005626', createdAtMs: 9_999_999_999_999 });
    expect(compareSourceLatest(highId, lowId)).toBeLessThan(0);
  });

  it('本地上传（没有源站号）恒排最前，彼此按发布时间倒序', () => {
    const localNew = key({ videoId: 'l1', publishedAtMs: 1_790_272_404_982, createdAtMs: 1_790_272_404_982 });
    const localOld = key({ videoId: 'l2', publishedAtMs: 1_700_000_000_000, createdAtMs: 1_700_000_000_000 });
    const collected = key({ videoId: 'c1', externalId: '1000009452', createdAtMs: 1 });
    expect([collected, localOld, localNew].sort(compareSourceLatest).map((item) => item.videoId)).toEqual([
      'l1', 'l2', 'c1',
    ]);
  });

  it('非数字的源站号视作没有号，不与采集片混比', () => {
    expect(numericExternalId('1000009452')).toBe(1000009452);
    expect(numericExternalId('abc-123')).toBeNull();
    expect(numericExternalId('')).toBeNull();
    expect(numericExternalId(null)).toBeNull();

    const weird = key({ videoId: 'w', externalId: 'abcdef', publishedAtMs: 1_790_272_404_982, createdAtMs: 1 });
    const normal = key({ videoId: 'n', externalId: '1000009452', createdAtMs: 1 });
    // weird 被归到「本地上传」那一档，所以排在采集片前面
    expect(compareSourceLatest(weird, normal)).toBeLessThan(0);
  });

  it('号相同时按 id 倒序，保证全序', () => {
    const a = key({ videoId: 'aaaa', externalId: '1000009452' });
    const b = key({ videoId: 'bbbb', externalId: '1000009452' });
    expect(compareSourceLatest(b, a)).toBeLessThan(0);
    expect(compareSourceLatest(a, a)).toBe(0);
  });

  it('本地片的时间兜底链是 publishedAt → createdAt', () => {
    expect(localRecencyOf(key({ videoId: 'x', publishedAtMs: 5, createdAtMs: 1 }))).toBe(5);
    expect(localRecencyOf(key({ videoId: 'x', createdAtMs: 1 }))).toBe(1);
  });

  it('整表排序结果与源站前 8 条一致', () => {
    const items = [
      key({ videoId: 'a', externalId: '1000009661', createdAtMs: 3 }),
      key({ videoId: 'b', externalId: '1000009676', createdAtMs: 9 }),
      key({ videoId: 'c', externalId: '1000009681', createdAtMs: 1 }),
      key({ videoId: 'd', externalId: '1000009672', createdAtMs: 7 }),
    ];
    expect([...items].sort(compareSourceLatest).map((item) => Number(item.externalId))).toEqual([
      1000009681, 1000009676, 1000009672, 1000009661,
    ]);
  });
});

describe('观看历史上限', () => {
  it('每用户只保留 20 条', () => {
    expect(WATCH_HISTORY_LIMIT).toBe(20);
  });
});
