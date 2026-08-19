/** 详情页是 lazy chunk（含播放器 / hls）。首页空闲或悬停卡片时先拉下来。 */
export function prefetchWatchPage() {
  void import('../pages/WatchPage');
}
