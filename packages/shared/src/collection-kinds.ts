export const COLLECTION_CONTENT_KINDS = ['gv', 'mv', 'tv'] as const;
export type CollectionContentKind = (typeof COLLECTION_CONTENT_KINDS)[number];

const ALLOWED = new Set<string>(COLLECTION_CONTENT_KINDS);

/** 调度勾选：只认显式数组。缺省或脏数据都当成「未选」，不要回落到三类全开。 */
export function normalizeScheduleKinds(raw: unknown): CollectionContentKind[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<CollectionContentKind>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const kind = item.trim().toLowerCase();
    if (!ALLOWED.has(kind) || seen.has(kind as CollectionContentKind)) continue;
    seen.add(kind as CollectionContentKind);
  }
  return COLLECTION_CONTENT_KINDS.filter((kind) => seen.has(kind));
}
