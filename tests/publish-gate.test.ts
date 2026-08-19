import { describe, expect, it } from 'vitest';
import { isAlreadyPublished, reviewHoldPatch } from '@videox/shared';

describe('发布闸门', () => {
  it('已公开且有上架时间的片子不改（排版片继续在首页）', () => {
    const video = { visibility: 'public', publishedAt: new Date('2026-01-01') };
    expect(isAlreadyPublished(video)).toBe(true);
    expect(reviewHoldPatch(video)).toEqual({});
  });

  it('新转码的公开片先压成 unlisted，清掉 publishedAt', () => {
    expect(reviewHoldPatch({ visibility: 'public', publishedAt: null })).toEqual({
      visibility: 'unlisted',
      publishedAt: null,
    });
  });

  it('本来就是私密的保持私密', () => {
    expect(reviewHoldPatch({ visibility: 'private', publishedAt: null })).toEqual({
      publishedAt: null,
    });
  });
});
