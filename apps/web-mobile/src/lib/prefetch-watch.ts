/** 详情页是 lazy chunk（含播放器 / hls）。列表空闲或按卡片时先拉下来，避免首次点进全屏黑一下。 */
export function prefetchWatchPage() {
  void import('../pages/WatchPage');
}
