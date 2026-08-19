import { describe, expect, it } from 'vitest';
import {
  expectedDimensionsForKind,
  isVerticalVideo,
  kindToOrientation,
  resolveListOrientation,
} from '@videox/shared';

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

describe('VOD 与 Shorts 目录独立', () => {
  it('kind=shorts 映射竖屏，kind=vod 映射横屏', () => {
    expect(kindToOrientation('shorts')).toBe('vertical');
    expect(kindToOrientation('vod')).toBe('horizontal');
    expect(kindToOrientation(undefined)).toBeUndefined();
  });

  it('列表分流：orientation 优先于 kind', () => {
    expect(resolveListOrientation({ orientation: 'horizontal', kind: 'shorts' })).toBe('horizontal');
    expect(resolveListOrientation({ kind: 'shorts' })).toBe('vertical');
    expect(resolveListOrientation({ kind: 'vod' })).toBe('horizontal');
  });

  it('上传 kind 占位尺寸让探测前即可分流', () => {
    const shorts = expectedDimensionsForKind('shorts');
    const vod = expectedDimensionsForKind('vod');
    expect(shorts && shorts.height > shorts.width).toBe(true);
    expect(vod && vod.width >= vod.height).toBe(true);
  });

  it('空 Shorts 不回落到点播：横屏不算竖屏', () => {
    expect(isVerticalVideo({ width: 1920, height: 1080 })).toBe(false);
    expect(isVerticalVideo({ width: 1280, height: 720 })).toBe(false);
  });
});
