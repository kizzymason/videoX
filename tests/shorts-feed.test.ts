import { describe, expect, it } from 'vitest';
import { isHorizontalVideo, isVerticalVideo, shortsUsePlayableFallback } from '@videox/shared';

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

describe('点播横屏判定', () => {
  it('宽大于等于高算点播', () => {
    expect(isHorizontalVideo({ width: 1920, height: 1080 })).toBe(true);
    expect(isHorizontalVideo({ width: 1080, height: 1080 })).toBe(true);
    expect(isHorizontalVideo({ width: 1080, height: 1920 })).toBe(false);
  });

  it('宽高未知的按点播收录，避免采集入库后首页空窗', () => {
    expect(isHorizontalVideo({ width: null, height: null })).toBe(true);
    expect(isHorizontalVideo({ width: null, height: 1080 })).toBe(true);
    expect(isHorizontalVideo({ width: 1920, height: null })).toBe(true);
  });
});

describe('Shorts 不回落点播', () => {
  it('竖屏为空也不回落普通可播片', () => {
    expect(shortsUsePlayableFallback(0)).toBe(false);
  });

  it('有竖屏时仍只出竖屏', () => {
    expect(shortsUsePlayableFallback(1)).toBe(false);
    expect(shortsUsePlayableFallback(12)).toBe(false);
  });
});
