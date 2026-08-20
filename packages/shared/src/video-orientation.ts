/**
 * 画面比例辅助。前台列表不再用它们过滤，播放器横竖都支持。
 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}

export function isHorizontalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  if (video.width == null || video.height == null) return true;
  return video.width >= video.height;
}

/**
 * Shorts 与点播独立：竖屏库存为空时不再回落普通可播点播。
 * 保留函数以免旧 import 炸，恒为 false。
 */
export function shortsUsePlayableFallback(_verticalTotal: number): boolean {
  return false;
}
