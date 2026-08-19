/** 竖屏片：高大于宽。宽高未知的不进竖屏过滤。 */
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
  return video.width != null && video.height != null && video.width >= video.height;
}

/**
 * Catalog type is videos.kind (vod | shorts), not width/height orientation.
 * Empty Shorts inventory stays empty; never fall back to playable VOD.
 */
export function shortsUsePlayableFallback(_verticalTotal: number): boolean {
  return false;
}
