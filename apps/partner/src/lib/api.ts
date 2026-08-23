import { ApiClient, ApiError } from '@videox/shared';
import type {
  AuthSession,
  CurrentUser,
  Paginated,
  PartnerCustomer,
  PartnerOverview,
  PartnerProfile,
  RedeemCode,
} from '@videox/shared';

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
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

type Query = Record<string, unknown>;

export const authApi = {
  login: (body: { identifier: string; password: string; remember?: boolean }) =>
    api.post<AuthSession>('/auth/login', body),
  logout: () => api.post<null>('/auth/logout'),
};

export const partnerApi = {
  me: () => api.get<PartnerProfile>('/partner/me'),
  overview: () => api.get<PartnerOverview>('/partner/overview'),
  customers: (query: Query) => api.get<Paginated<PartnerCustomer>>('/partner/customers', query),
  grant: (id: string, days: number) => api.post<{ vipExpiresAt: string }>(`/partner/customers/${id}/grant`, { days }),
  codes: (query: Query) => api.get<Paginated<RedeemCode>>('/partner/codes', query),
  generate: (body: { days: number; count: number; salePriceYuan: number; note?: string; expiresAt?: string }) =>
    api.post<{ batchId: string; codes: string[] }>('/partner/codes/generate', body),
  disable: (id: string) => api.post<null>(`/partner/codes/${id}/disable`),
  bulkDelete: (ids: string[]) => api.post<{ deleted: number }>('/partner/codes/bulk-delete', { ids }),
};

export async function downloadPartnerCodesCsv(query: Query = {}): Promise<void> {
  const res = await api.get<Response>('/partner/codes/export', query, { raw: true });
  if (!res.ok) throw new ApiError({ message: `导出失败 (${res.status})`, code: res.status, status: res.status });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `partner-codes-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
