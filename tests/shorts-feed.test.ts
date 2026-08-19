import { describe, expect, it } from 'vitest';
import { isVerticalVideo, shortsUsePlayableFallback } from '@videox/shared';

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

describe('Shorts 空竖屏回落', () => {
  it('竖屏一条都没有时回落到可播片', () => {
    expect(shortsUsePlayableFallback(0)).toBe(true);
  });

  it('有竖屏时仍只出竖屏', () => {
    expect(shortsUsePlayableFallback(1)).toBe(false);
    expect(shortsUsePlayableFallback(12)).toBe(false);
  });
});
