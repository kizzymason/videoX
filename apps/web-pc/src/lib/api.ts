import { ApiClient, ApiError } from '@videox/shared';
import type {
  AuthSession,
  Banner,
  Category,
  Comment,
  CurrentUser,
  FavoriteItem,
  MembershipPlan,
  Paginated,
  PlaybackTicket,
  PublicUser,
  RedeemResult,
  SiteSettings,
  Subscription,
  Tag,
  VideoDetail,
  VideoSummary,
  WatchHistoryItem,
} from '@videox/shared';

/** 内存里的 access token。刻意不落 localStorage：XSS 拿不到，刷新页面靠 httpOnly 的 refresh cookie 换新。 */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const api = new ApiClient({
  baseUrl: BASE_URL,
  getAccessToken: () => accessToken,
  onRefresh: async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const payload = (await res.json()) as { data?: AuthSession };
      accessToken = payload.data?.accessToken ?? null;
      return accessToken;
    } catch {
      return null;
    }
  },
  onUnauthorized: () => {
    accessToken = null;
    onUnauthorized?.();
  },
});

export { ApiError };

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

export const authApi = {
  register: (body: { username: string; password: string; email?: string; displayName?: string }) =>
    api.post<AuthSession>('/auth/register', body),
  login: (body: { identifier: string; password: string; remember?: boolean }) =>
    api.post<AuthSession>('/auth/login', body),
  logout: () => api.post<null>('/auth/logout'),
  me: () => api.get<CurrentUser>('/auth/me'),
  updateProfile: (body: { displayName?: string; bio?: string | null; avatarUrl?: string | null }) =>
    api.patch<CurrentUser>('/auth/me', body),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<null>('/auth/change-password', body),
  sessions: () =>
    api.get<{ id: string; userAgent: string; ip: string; createdAt: string; expiresAt: string }[]>('/auth/sessions'),
};

// ---------------------------------------------------------------------------
// 内容
// ---------------------------------------------------------------------------

export interface VideoListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  tag?: string;
  authorId?: string;
  accessLevel?: string;
  sort?: string;
  minDuration?: number;
  maxDuration?: number;
}

export const contentApi = {
  videos: (query: VideoListQuery) => api.get<Paginated<VideoSummary>>('/videos', query as Record<string, unknown>),
  video: (idOrSlug: string) => api.get<VideoDetail>(`/videos/${encodeURIComponent(idOrSlug)}`),
  related: (id: string, limit = 12) => api.get<VideoSummary[]>(`/videos/${id}/related`, { limit }),
  moreFromAuthor: (id: string, limit = 8) => api.get<VideoSummary[]>(`/videos/${id}/more-from-author`, { limit }),
  playTicket: (id: string) => api.post<PlaybackTicket>(`/videos/${id}/play-ticket`),
  renewTicket: (id: string) =>
    api.post<{
      token: string;
      scope: 'full' | 'preview';
      previewSeconds: number | null;
      expiresAt: string;
      ttlSeconds: number;
      masterUrl: string;
    }>(`/videos/${id}/renew-ticket`),

  categories: () => api.get<Category[]>('/categories'),
  category: (slug: string) => api.get<Category>(`/categories/${encodeURIComponent(slug)}`),
  tags: (limit = 60) => api.get<Tag[]>('/tags', { limit }),
  banners: () => api.get<Banner[]>('/banners'),
  bannerClick: (id: string) => api.post<null>(`/banners/${id}/click`),
  site: () => api.get<SiteSettings>('/site'),

  search: (query: VideoListQuery & { q: string }) =>
    api.get<Paginated<VideoSummary>>('/search', { ...query }),
  suggest: (q: string) =>
    api.get<{
      videos: { id: string; title: string; posterUrl: string | null; viewCount: number }[];
      tags: { name: string; slug: string; videoCount: number }[];
    }>('/search/suggest', { q }),
  hotKeywords: () => api.get<string[]>('/search/hot'),

  channel: (username: string) =>
    api.get<PublicUser & { following: boolean; totalViews: number }>(`/users/${encodeURIComponent(username)}`),
  channelVideos: (username: string, page = 1, pageSize = 24) =>
    api.get<Paginated<VideoSummary>>(`/users/${encodeURIComponent(username)}/videos`, { page, pageSize }),

  recommend: (query: { limit?: number; exclude?: string; immersive?: boolean }) =>
    api.get<VideoSummary[]>('/recommend/feed', query as Record<string, unknown>),
};

// ---------------------------------------------------------------------------
// 互动
// ---------------------------------------------------------------------------

export const socialApi = {
  like: (videoId: string) => api.post<{ liked: boolean; likeCount: number }>(`/videos/${videoId}/like`),
  favorite: (videoId: string) => api.post<{ favorited: boolean }>(`/videos/${videoId}/favorite`),
  follow: (userId: string) => api.post<{ following: boolean }>(`/users/${userId}/follow`),

  favorites: (page = 1, pageSize = 24) => api.get<Paginated<FavoriteItem>>('/favorites', { page, pageSize }),
  following: (page = 1, pageSize = 24) => api.get<Paginated<PublicUser>>('/following', { page, pageSize }),
  followingFeed: (page = 1, pageSize = 24) => api.get<Paginated<VideoSummary>>('/following/feed', { page, pageSize }),

  history: (page = 1, pageSize = 24) => api.get<Paginated<WatchHistoryItem>>('/history', { page, pageSize }),
  removeHistory: (videoId: string) => api.delete<null>(`/history/${videoId}`),
  clearHistory: () => api.delete<null>('/history'),
  continueWatching: (limit = 10) => api.get<WatchHistoryItem[]>('/continue-watching', { limit }),

  saveProgress: (body: { videoId: string; positionSeconds: number; durationSeconds?: number; deltaSeconds?: number }) =>
    api.post<{ saved: true; completed: boolean }>('/progress', body),

  comments: (query: { videoId: string; page?: number; pageSize?: number; sort?: string }) =>
    api.get<Paginated<Comment>>('/comments', query as Record<string, unknown>),
  replies: (rootId: string, page = 1, pageSize = 20) =>
    api.get<Paginated<Comment>>(`/comments/${rootId}/replies`, { page, pageSize }),
  createComment: (body: { videoId: string; content: string; parentId?: string }) =>
    api.post<Comment>('/comments', body),
  likeComment: (id: string) => api.post<{ liked: boolean; likeCount: number }>(`/comments/${id}/like`),
  deleteComment: (id: string) => api.delete<null>(`/comments/${id}`),
  reportComment: (id: string) => api.post<null>(`/comments/${id}/report`),
};

// ---------------------------------------------------------------------------
// 会员
// ---------------------------------------------------------------------------

export const membershipApi = {
  plans: () => api.get<MembershipPlan[]>('/membership/plans'),
  redeem: (code: string) => api.post<RedeemResult>('/membership/redeem', { code }),
  me: () =>
    api.get<{
      isVip: boolean;
      vipExpiresAt: string | null;
      daysRemaining: number | null;
      subscriptions: Subscription[];
    }>('/membership/me'),
  orders: () =>
    api.get<
      {
        id: string;
        orderNo: string;
        planName: string | null;
        amountCents: number;
        source: string;
        status: string;
        createdAt: string;
      }[]
    >('/membership/orders'),
};
