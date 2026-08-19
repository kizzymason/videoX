/** 竖屏片：高大于宽。宽高未知的不进 Shorts。 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}
