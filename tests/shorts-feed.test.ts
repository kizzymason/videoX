import { describe, expect, it } from 'vitest';
import { isVerticalVideo } from '@videox/shared';

describe('竖屏判定', () => {
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
