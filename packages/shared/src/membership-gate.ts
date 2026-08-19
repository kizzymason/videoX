import { PLAYABLE_VIDEO_STATUSES, type VideoKind, type VideoStatus, type VideoVisibility } from './constants.js';

export type GateReason = 'login_required' | 'vip_required' | 'unavailable' | null;

export interface GateResult {
  canPlay: boolean;
  gateReason: GateReason;
}

/**
 * 播放门禁。点播全站仅会员可播；Shorts 在详情层放行，3 条额度在签发票据时扣。
 */
export function evaluateGate(
  video: { kind: VideoKind | string; status: VideoStatus | string; visibility: VideoVisibility | string },
  viewer: { userId?: string | null; isVip: boolean; isAdmin: boolean },
): GateResult {
  if (viewer.isAdmin || viewer.isVip) return { canPlay: true, gateReason: null };

  if (!PLAYABLE_VIDEO_STATUSES.includes(video.status as VideoStatus)) {
    return { canPlay: false, gateReason: 'unavailable' };
  }
  if (video.visibility === 'private') {
    return { canPlay: false, gateReason: 'unavailable' };
  }

  if (video.kind === 'shorts') {
    return { canPlay: true, gateReason: null };
  }

  return { canPlay: false, gateReason: 'vip_required' };
}
