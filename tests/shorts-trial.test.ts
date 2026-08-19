import { describe, expect, it } from 'vitest';
import { decideShortsTrial, parseShortsTrialDetails } from '@videox/shared';

describe('Shorts 按条试看', () => {
  it('前 3 条不同视频都放行，并累计已看', () => {
    const a = decideShortsTrial([], 'a', 3);
    expect(a).toMatchObject({ allow: true, already: false, used: 1, remaining: 2, nextIds: ['a'] });

    const b = decideShortsTrial(a.nextIds, 'b', 3);
    expect(b).toMatchObject({ allow: true, used: 2, remaining: 1, nextIds: ['a', 'b'] });

    const c = decideShortsTrial(b.nextIds, 'c', 3);
    expect(c).toMatchObject({ allow: true, used: 3, remaining: 0, nextIds: ['a', 'b', 'c'] });
  });

  it('同一条再看不占名额', () => {
    const again = decideShortsTrial(['a', 'b'], 'a', 3);
    expect(again).toMatchObject({ allow: true, already: true, used: 2, remaining: 1, nextIds: ['a', 'b'] });
  });

  it('第 4 条不同视频拒绝', () => {
    const denied = decideShortsTrial(['a', 'b', 'c'], 'd', 3);
    expect(denied).toEqual({ allow: false, already: false, nextIds: ['a', 'b', 'c'], used: 3, remaining: 0 });
  });

  it('满额后重看已看过的仍放行', () => {
    const replay = decideShortsTrial(['a', 'b', 'c'], 'b', 3);
    expect(replay).toMatchObject({ allow: true, already: true, used: 3, remaining: 0 });
  });

  it('限额为 0 时一条都不放', () => {
    expect(decideShortsTrial([], 'a', 0)).toMatchObject({ allow: false, used: 0, remaining: 0 });
  });

  it('重复 id 去重后再计数', () => {
    const decision = decideShortsTrial(['a', 'a', 'b'], 'c', 3);
    expect(decision).toMatchObject({ allow: true, used: 3, remaining: 0, nextIds: ['a', 'b', 'c'] });
  });
});

describe('parseShortsTrialDetails', () => {
  it('从 402 details 取出额度', () => {
    expect(parseShortsTrialDetails({ shortsTrial: { used: 3, limit: 3, remaining: 0 } })).toEqual({
      used: 3,
      limit: 3,
      remaining: 0,
    });
  });

  it('非法结构返回 null', () => {
    expect(parseShortsTrialDetails(null)).toBeNull();
    expect(parseShortsTrialDetails({ shortsTrial: { used: 'x' } })).toBeNull();
  });
});
