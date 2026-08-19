import { describe, expect, it } from 'vitest';
import { VIDEO_KINDS, isVerticalVideo, shortsUsePlayableFallback } from '@videox/shared';

describe('Shorts 竖屏判定', () => {
  it('高大于宽才算竖屏', () => {
    expect(isVerticalVideo({ width: 1080, height: 1920 })).toBe(true);
    expect(isVerticalVideo({ width: 1920, height: 1080 })).toBe(false);
    expect(isVerticalVideo({ width: 1080, height: 1080 })).toBe(false);
  });

  it('宽高未知的不进信息流', () => {
    expect(isVerticalVideo({ width: null, height: 1920 })).toBe(false);
    expect(isVerticalVideo({ width: 1080, height: null })).toBe(false);
  });
});

describe('Shorts 空库存不回落', () => {
  it('shortsUsePlayableFallback 始终为 false（目录用 kind，不用方向）', () => {
    expect(shortsUsePlayableFallback(0)).toBe(false);
    expect(shortsUsePlayableFallback(1)).toBe(false);
    expect(shortsUsePlayableFallback(12)).toBe(false);
  });
});

describe('VIDEO_KINDS', () => {
  it('包含 vod 与 shorts', () => {
    expect(VIDEO_KINDS).toContain('vod');
    expect(VIDEO_KINDS).toContain('shorts');
  });
});
