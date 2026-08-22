// ========================================================================
// 「最新」对齐源站列表：页码越小越新，同页按采集时的列表顺序。
// 本地上传（没有 collected_videos）排在最前，再按发布时间倒序。
// ========================================================================

export interface SourceLatestKey {
  collectedPage: number | null;
  collectedAtMs: number | null;
  publishedAtMs: number;
}

/** 与 listVideos(sort=latest) 的 SQL 顺序一致，供单测锁契约。 */
export function compareSourceLatest(a: SourceLatestKey, b: SourceLatestKey): number {
  const aCollected = a.collectedPage !== null && a.collectedAtMs !== null;
  const bCollected = b.collectedPage !== null && b.collectedAtMs !== null;
  if (aCollected !== bCollected) return aCollected ? 1 : -1;
  if (aCollected && bCollected) {
    if (a.collectedPage !== b.collectedPage) return a.collectedPage! - b.collectedPage!;
    if (a.collectedAtMs !== b.collectedAtMs) return a.collectedAtMs! - b.collectedAtMs!;
    return 0;
  }
  return b.publishedAtMs - a.publishedAtMs;
}
