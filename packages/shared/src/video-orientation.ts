/** 竖屏片：高大于宽。宽高未知的不进 Shorts。 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}

/**
 * 点播列表：已知竖屏才排除。
 * 采集/热链入库经常没有探测宽高，未知尺寸按点收录，避免首页推荐/最新/热门空窗。
 */
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
