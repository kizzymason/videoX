/**
 * 管理端发布闸门。
 *
 * 转码完成只代表「能播」，不得改可见性。
 * 上传时选了公开就必须保持公开；选不公开才进待审。
 */
export function isAlreadyPublished(video: {
  visibility: string;
  publishedAt: Date | string | null;
}): boolean {
  return video.visibility === 'public' && video.publishedAt != null;
}

export function reviewHoldPatch(_video: {
  visibility: string;
  publishedAt: Date | string | null;
}): { visibility?: 'unlisted'; publishedAt?: null } {
  return {};
}
