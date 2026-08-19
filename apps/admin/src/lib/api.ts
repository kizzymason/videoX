import { ApiClient, ApiError } from '@videox/shared';
import type {
  AiProfile,
  AiScoringRun,
  AlgoWeights,
  AuditLogEntry,
  AuthSession,
  Banner,
  Category,
  CurrentUser,
  DashboardOverview,
  MembershipPlan,
  Order,
  Paginated,
  RedeemCode,
  SiteSettings,
  StorageProfile,
  Tag,
  TranscodeJob,
  UploadSession,
  VideoRetentionPoint,
  VideoSummary,
  VisitorInsights,
} from '@videox/shared';

/** access token 只留在内存，刷新页面用 httpOnly 的 refresh cookie 换新。 */
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

export const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
// 后台专属行类型（后端拼装，shared 里没有对应声明）
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'user' | 'vip' | 'admin';
  status: 'active' | 'banned' | 'pending';
  isVip: boolean;
  vipExpiresAt: string | null;
  videoCount: number;
  followerCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminCommentRow {
  id: string;
  content: string;
  status: 'visible' | 'hidden' | 'deleted';
  likeCount: number;
  reportCount: number;
  createdAt: string;
  videoId: string;
  videoTitle: string | null;
  authorName: string | null;
  authorUsername: string | null;
}

export interface TopVideoRow {
  id: string;
  title: string;
  posterUrl: string | null;
  plays: number;
  watchSeconds: number;
  completionRate: number;
}

export interface AiScoreRow {
  id: string;
  title: string;
  posterUrl: string | null;
  aiScore: number | null;
  aiReason: string | null;
  aiScoredAt: string | null;
  viewCount: number;
}

/** SSE 推送的在途任务快照，比 TranscodeJob 精简。 */
export interface LiveTranscodeJob {
  id: string;
  videoId: string;
  videoTitle: string | null;
  status: TranscodeJob['status'];
  progress: number;
  stage: string | null;
  currentRendition: string | null;
  completedRenditions: string[];
  errorMessage: string | null;
}

export type Query = Record<string, unknown> & {
  /** 后台列表可选内容类型，例如 shorts；仅前端查询参数，不改后端。 */
  kind?: string;
};

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

export const authApi = {
  login: (body: { identifier: string; password: string; remember?: boolean }) =>
    api.post<AuthSession>('/auth/login', body),
  logout: () => api.post<null>('/auth/logout'),
  me: () => api.get<CurrentUser>('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<null>('/auth/change-password', body),
};

// ---------------------------------------------------------------------------
// 仪表盘
// ---------------------------------------------------------------------------

export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/admin/dashboard/overview'),
  insights: (days: number) => api.get<VisitorInsights>('/admin/dashboard/insights', { days }),
  topVideos: (days: number) => api.get<TopVideoRow[]>('/admin/dashboard/top-videos', { days }),
  retention: (id: string) => api.get<VideoRetentionPoint[]>(`/admin/dashboard/retention/${id}`),
  aggregate: () => api.post<null>('/admin/dashboard/aggregate'),
};

// ---------------------------------------------------------------------------
// 视频与转码
// ---------------------------------------------------------------------------

export type BulkAction =
  | 'publish'
  | 'unpublish'
  | 'archive'
  | 'delete'
  | 'retranscode'
  | 'set_access'
  | 'set_category';

export const videosApi = {
  list: (query: Query) => api.get<Paginated<VideoSummary>>('/admin/videos', query),
  update: (id: string, body: Query) => api.patch<unknown>(`/admin/videos/${id}`, body),
  remove: (id: string) => api.delete<null>(`/admin/videos/${id}`),
  retranscode: (id: string) => api.post<{ jobId: string }>(`/admin/videos/${id}/retranscode`),
  bulk: (body: { ids: string[]; action: BulkAction; accessLevel?: string; categoryId?: string }) =>
    api.post<{ affected: number }>('/admin/videos/bulk', body),

  jobs: (page = 1, pageSize = 20) => api.get<Paginated<TranscodeJob>>('/admin/transcode/jobs', { page, pageSize }),
  cancelJob: (id: string) => api.post<null>(`/admin/transcode/jobs/${id}/cancel`),
};

// ---------------------------------------------------------------------------
// 用户与评论
// ---------------------------------------------------------------------------

export const usersApi = {
  list: (query: Query) => api.get<Paginated<AdminUserRow>>('/admin/users', query),
  update: (id: string, body: Query) => api.patch<{ id: string; role: string; status: string }>(`/admin/users/${id}`, body),
  grantVip: (body: { userId: string; days: number; note?: string }) =>
    api.post<{ vipExpiresAt: string }>('/admin/users/grant-vip', body),
  revokeVip: (id: string) => api.post<null>(`/admin/users/${id}/revoke-vip`),
};

export const commentsApi = {
  list: (query: Query) => api.get<Paginated<AdminCommentRow>>('/admin/comments', query),
  moderate: (id: string, status: 'visible' | 'hidden' | 'deleted') =>
    api.post<null>(`/admin/comments/${id}/moderate`, { status }),
};

// ---------------------------------------------------------------------------
// 运营配置
// ---------------------------------------------------------------------------

export const catalogApi = {
  categories: () => api.get<Category[]>('/admin/categories'),
  createCategory: (body: Query) => api.post<Category>('/admin/categories', body),
  updateCategory: (id: string, body: Query) => api.patch<Category>(`/admin/categories/${id}`, body),
  deleteCategory: (id: string) => api.delete<null>(`/admin/categories/${id}`),

  tags: (page = 1, pageSize = 60) => api.get<Paginated<Tag>>('/admin/tags', { page, pageSize }),
  deleteTag: (id: string) => api.delete<null>(`/admin/tags/${id}`),

  banners: () => api.get<Banner[]>('/admin/banners'),
  createBanner: (body: Query) => api.post<Banner>('/admin/banners', body),
  updateBanner: (id: string, body: Query) => api.patch<Banner>(`/admin/banners/${id}`, body),
  deleteBanner: (id: string) => api.delete<null>(`/admin/banners/${id}`),
};

// ---------------------------------------------------------------------------
// 会员
// ---------------------------------------------------------------------------

export const membershipApi = {
  plans: () => api.get<MembershipPlan[]>('/admin/plans'),
  createPlan: (body: Query) => api.post<MembershipPlan>('/admin/plans', body),
  updatePlan: (id: string, body: Query) => api.patch<MembershipPlan>(`/admin/plans/${id}`, body),
  deletePlan: (id: string) => api.delete<null>(`/admin/plans/${id}`),

  codes: (query: Query) => api.get<Paginated<RedeemCode>>('/admin/redeem-codes', query),
  generateCodes: (body: { planId: string; count: number; prefix?: string; expiresAt?: string; note?: string }) =>
    api.post<{ batchId: string; codes: string[] }>('/admin/redeem-codes/generate', body),
  disableCode: (id: string) => api.post<null>(`/admin/redeem-codes/${id}/disable`),

  orders: (query: Query) => api.get<Paginated<Order>>('/admin/orders', query),
};

/** CSV 导出走 raw Response，再交给浏览器下载，避免被 unwrap 当 JSON 解析。 */
export async function downloadRedeemCodesCsv(query: Query): Promise<void> {
  const res = await api.get<Response>('/admin/redeem-codes/export', query, { raw: true });
  if (!res.ok) throw new ApiError({ message: `导出失败 (${res.status})`, code: res.status, status: res.status });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `redeem-codes-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 系统配置
// ---------------------------------------------------------------------------

export const systemApi = {
  storage: () => api.get<StorageProfile[]>('/admin/storage'),
  createStorage: (body: Query) => api.post<StorageProfile>('/admin/storage', body),
  updateStorage: (id: string, body: Query) => api.patch<StorageProfile>(`/admin/storage/${id}`, body),
  activateStorage: (id: string) => api.post<null>(`/admin/storage/${id}/activate`),
  testStorage: (id: string, body?: Query) => api.post<{ ok: boolean; message: string }>(`/admin/storage/${id}/test`, body),
  deleteStorage: (id: string) => api.delete<null>(`/admin/storage/${id}`),

  site: () => api.get<SiteSettings>('/admin/settings/site'),
  saveSite: (body: SiteSettings) => api.put<SiteSettings>('/admin/settings/site', body),
  algo: () => api.get<AlgoWeights>('/admin/settings/algo'),
  saveAlgo: (body: AlgoWeights) => api.put<AlgoWeights>('/admin/settings/algo', body),

  aiProfiles: () => api.get<AiProfile[]>('/admin/ai/profiles'),
  createAiProfile: (body: Query) => api.post<AiProfile>('/admin/ai/profiles', body),
  updateAiProfile: (id: string, body: Query) => api.patch<AiProfile>(`/admin/ai/profiles/${id}`, body),
  deleteAiProfile: (id: string) => api.delete<null>(`/admin/ai/profiles/${id}`),
  runAiProfile: (id: string, videoIds?: string[]) =>
    api.post<{ runId: string }>(`/admin/ai/profiles/${id}/run`, videoIds ? { videoIds } : undefined),
  aiRuns: () => api.get<AiScoringRun[]>('/admin/ai/runs'),
  aiScores: (page = 1, pageSize = 20) => api.get<Paginated<AiScoreRow>>('/admin/ai/scores', { page, pageSize }),

  auditLogs: (page = 1, pageSize = 30) => api.get<Paginated<AuditLogEntry>>('/admin/audit-logs', { page, pageSize }),
};

// ---------------------------------------------------------------------------
// 上传
// ---------------------------------------------------------------------------

export interface UploadInitResult extends UploadSession {
  existingVideoId: string | null;
}

export const uploadApi = {
  init: (body: { filename: string; fileSize: number; chunkSize: number; fileHash?: string; mimeType?: string }) =>
    api.post<UploadInitResult>('/uploads/init', body),
  session: (id: string) => api.get<UploadSession>(`/uploads/${id}`),
  complete: (
    id: string,
    body: {
      title?: string;
      description?: string;
      categoryId?: string;
      tags?: string[];
      accessLevel: string;
      visibility: string;
    },
  ) => api.post<{ videoId: string; jobId: string | null; instant: boolean }>(`/uploads/${id}/complete`, body),
  abort: (id: string) => api.post<null>(`/uploads/${id}/abort`),
};

/**
 * 分片上传走裸 fetch：ApiClient 会把 body JSON 化，而这里要发二进制。
 * 同时需要 XHR 之外的 AbortSignal 支持，fetch 正好够用。
 */
export async function putChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
  sha256: string,
  signal?: AbortSignal,
): Promise<{ index: number; receivedCount: number; complete: boolean }> {
  const res = await fetch(`${BASE_URL}/uploads/${uploadId}/part/${index}`, {
    method: 'PUT',
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-chunk-sha256': sha256,
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: chunk,
  });
  const payload = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: { index: number; receivedCount: number; complete: boolean };
  };
  if (!res.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new ApiError({
      message: payload.message || `分片 ${index} 上传失败`,
      code: payload.code ?? res.status,
      status: res.status,
    });
  }
  return payload.data!;
}
