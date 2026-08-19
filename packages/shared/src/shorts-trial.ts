/** Shorts 游客/非会员可完整看的条数。超出后必须订阅。 */
export const DEFAULT_SHORTS_FREE_COUNT = 3;

export interface ShortsTrialQuota {
  used: number;
  limit: number;
  remaining: number;
}

/** 从 402 错误 details 里取出 Shorts 试看额度。 */
export function parseShortsTrialDetails(details: unknown): ShortsTrialQuota | null {
  if (!details || typeof details !== 'object') return null;
  const raw = (details as { shortsTrial?: unknown }).shortsTrial;
  if (!raw || typeof raw !== 'object') return null;
  const used = Number((raw as { used?: unknown }).used);
  const limit = Number((raw as { limit?: unknown }).limit);
  const remaining = Number((raw as { remaining?: unknown }).remaining);
  if (![used, limit, remaining].every((n) => Number.isFinite(n))) return null;
  return { used, limit, remaining };
}

export interface ShortsTrialDecision {
  allow: boolean;
  already: boolean;
  nextIds: string[];
  used: number;
  remaining: number;
}

/**
 * 按「看过的不同 Shorts id」计数。同一条再看不占名额。
 * 满额且不是已看过的，拒绝。
 */
export function decideShortsTrial(
  watchedIds: readonly string[],
  videoId: string,
  limit = DEFAULT_SHORTS_FREE_COUNT,
): ShortsTrialDecision {
  const unique: string[] = [];
  for (const id of watchedIds) {
    if (id && !unique.includes(id)) unique.push(id);
  }
  const cap = Math.max(0, limit);
  const already = unique.includes(videoId);
  if (already) {
    return {
      allow: true,
      already: true,
      nextIds: unique,
      used: unique.length,
      remaining: Math.max(0, cap - unique.length),
    };
  }
  if (unique.length >= cap) {
    return { allow: false, already: false, nextIds: unique, used: unique.length, remaining: 0 };
  }
  const nextIds = [...unique, videoId];
  return {
    allow: true,
    already: false,
    nextIds,
    used: nextIds.length,
    remaining: Math.max(0, cap - nextIds.length),
  };
}
