import type { VideoKind } from './constants.js';

/** 竖屏片：高大于宽。宽高未知的不进 Shorts。 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}

/** Shorts = 竖屏；点播 = 横屏（含方屏）。 */
export function kindToOrientation(kind: VideoKind | undefined): 'vertical' | 'horizontal' | undefined {
  if (kind === 'shorts') return 'vertical';
  if (kind === 'vod') return 'horizontal';
  return undefined;
}

/**
 * 列表分流：显式 orientation 优先，否则用上传/查询 kind。
 * 空 Shorts 保持空，不回落点播。
 */
export function resolveListOrientation(options: {
  orientation?: 'vertical' | 'horizontal';
  kind?: VideoKind;
}): 'vertical' | 'horizontal' | undefined {
  return options.orientation ?? kindToOrientation(options.kind);
}

/**
 * 上传时宽高尚未探测，用占位尺寸让后台 Shorts/点播列表立刻分流。
 * 转码 probe 会覆盖成真实宽高；不建 kind 列、不做回填。
 */
export function expectedDimensionsForKind(
  kind: VideoKind | undefined,
): { width: number; height: number } | undefined {
  if (kind === 'shorts') return { width: 1080, height: 1920 };
  if (kind === 'vod') return { width: 1920, height: 1080 };
  return undefined;
}
