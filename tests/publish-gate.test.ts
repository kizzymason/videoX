import { describe, expect, it } from 'vitest';
import { isAlreadyPublished, reviewHoldPatch } from '@videox/shared';

describe('发布闸门', () => {
  it('已公开且有上架时间的片子不改', () => {
    const video = { visibility: 'public', publishedAt: new Date('2026-01-01') };
    expect(isAlreadyPublished(video)).toBe(true);
    expect(reviewHoldPatch(video)).toEqual({});
  });

  it('选了公开就保持公开，转码不得压成 unlisted', () => {
    expect(reviewHoldPatch({ visibility: 'public', publishedAt: null })).toEqual({});
  });

  it('本来就是私密的也不被转码改掉', () => {
    expect(reviewHoldPatch({ visibility: 'private', publishedAt: null })).toEqual({});
  });
});
