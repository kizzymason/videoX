/** 竖屏片：高大于宽。宽高未知的不进 Shorts。 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}

/** 点播：宽大于等于高。宽高未知的不进首页点播列表。 */
export function isHorizontalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.width >= video.height;
}

/**
 * Shorts 与点播独立：竖屏库存为空时不再回落普通可播点播。
 * 保留函数以免旧 import 炸，恒为 false。
 */
export function shortsUsePlayableFallback(_verticalTotal: number): boolean {
  return false;
}
