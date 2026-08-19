import { describe, expect, it } from 'vitest';
import { VIDEO_KINDS, type VideoKind } from '@videox/shared';

describe('VIDEO_KINDS', () => {
  it('includes vod and shorts', () => {
    expect(VIDEO_KINDS).toEqual(['vod', 'shorts']);
    const vod: VideoKind = 'vod';
    const shorts: VideoKind = 'shorts';
    expect(VIDEO_KINDS.includes(vod)).toBe(true);
    expect(VIDEO_KINDS.includes(shorts)).toBe(true);
  });
});
