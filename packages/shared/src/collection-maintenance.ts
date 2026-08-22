export interface CollectedDedupeCandidate {
  id: string;
  externalId: string;
  title: string;
  kind: string;
  status: string;
  videoId: string | null;
  externalPlayUrl: string | null;
  updatedAt: string | Date | null;
}

export function normalizeDedupeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function collectedDedupeScore(item: CollectedDedupeCandidate): number {
  let score = 0;
  if (item.status === 'imported') score += 100;
  else if (item.status === 'updating') score += 40;
  else if (item.status === 'pending') score += 20;
  if (item.videoId) score += 15;
  if (item.externalPlayUrl) score += 5;
  const updated = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  score += Math.max(0, Math.floor(updated / 1000) / 1_000_000_000);
  return score;
}

export function pickCollectedDedupeWinner<T extends CollectedDedupeCandidate>(
  items: T[],
): { keep: T; drop: T[] } {
  const sorted = [...items].sort((a, b) => collectedDedupeScore(b) - collectedDedupeScore(a));
  return { keep: sorted[0]!, drop: sorted.slice(1) };
}

export function groupDuplicateRows<T>(items: T[], keyOf: (item: T) => string | null): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.values()].filter((group) => group.length > 1);
}

export const RETRY_FAILED_JOBS_MAX = 2000;
export const CLEAR_FAILED_JOBS_MAX = 10_000;
