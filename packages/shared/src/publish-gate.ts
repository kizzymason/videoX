/**
 * 管理端发布闸门。
 *
 * 转码完成只代表「能播」，不代表「上前台」。
 * 已经公开且带 publishedAt 的片子（含老板要看排版的有 HLS 种子）保持原样；
 * 新转码 / 未上架的改 unlisted，等后台通过。
 */
export function isAlreadyPublished(video: {
  visibility: string;
  publishedAt: Date | string | null;
}): boolean {
  return video.visibility === 'public' && video.publishedAt != null;
}

export function reviewHoldPatch(video: {
  visibility: string;
  publishedAt: Date | string | null;
}): { visibility?: 'unlisted'; publishedAt?: null } {
  if (isAlreadyPublished(video)) return {};
  if (video.visibility === 'private') return { publishedAt: null };
  return { visibility: 'unlisted', publishedAt: null };
}
