/** 竖屏片：高大于宽。宽高未知的不进 Shorts。 */
export function isVerticalVideo(video: {
  width: number | null;
  height: number | null;
}): boolean {
  return video.width != null && video.height != null && video.height > video.width;
}

/**
 * 竖屏优先。竖屏可播条数为 0 时，Shorts 回落到任意已通过可播片。
 * 预览/冷启动没有竖屏种子时信息流不能空；一旦有竖屏，仍只出竖屏。
 */
export function shortsUsePlayableFallback(verticalTotal: number): boolean {
  return verticalTotal === 0;
}
