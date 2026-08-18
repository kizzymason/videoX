import type { ApiEnvelope } from './types.js';

export class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly traceId: string;
  readonly details: unknown;

  constructor(params: { message: string; code: number; status: number; traceId?: string; details?: unknown }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.traceId = params.traceId ?? '';
    this.details = params.details;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** 402 表示需要会员权限，前端据此弹开通引导。 */
  get needsVip(): boolean {
    return this.status === 402;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null;
  /** 401 时调用，返回新的 access token；返回 null 表示刷新失败 */
  onRefresh?: () => Promise<string | null>;
  onUnauthorized?: () => void;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 跳过自动刷新逻辑，避免刷新接口自身递归 */
  skipAuthRefresh?: boolean;
  /** 直接返回 Response，用于下载 CSV 等场景 */
  raw?: boolean;
}

export function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null && v !== '') params.append(key, String(v));
      }
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class ApiClient {
  private readonly options: ApiClientOptions;
  private refreshing: Promise<string | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.options = options;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  private async refreshOnce(): Promise<string | null> {
    if (!this.options.onRefresh) return null;
    // 并发的 401 只触发一次刷新，其余请求复用同一个 promise。
    this.refreshing ??= this.options.onRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    if (options.raw) return response as unknown as T;
    return this.unwrap<T>(response);
  }

  private async send(path: string, options: RequestOptions, isRetry = false): Promise<Response> {
    const url = `${this.options.baseUrl}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
      ...options.headers,
    };

    const token = this.options.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    // 不写 BodyInit：这个包同时被 Node 侧引用，而 @types/node 并不导出该全局类型。
    let body: NonNullable<RequestInit['body']> | undefined;
    if (options.body instanceof FormData || options.body instanceof Blob || options.body instanceof ArrayBuffer) {
      body = options.body as NonNullable<RequestInit['body']>;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });

    if (response.status === 401 && !options.skipAuthRefresh && !isRetry) {
      const fresh = await this.refreshOnce();
      if (fresh) return this.send(path, options, true);
      this.options.onUnauthorized?.();
    }

    return response;
  }

  private async unwrap<T>(response: Response): Promise<T> {
    const text = await response.text();
    let payload: Partial<ApiEnvelope<T>> & { details?: unknown } = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 300) };
      }
    }

    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new ApiError({
        message: payload.message || `请求失败 (${response.status})`,
        code: payload.code ?? response.status,
        status: response.status,
        traceId: payload.traceId,
        details: payload.details,
      });
    }

    return payload.data as T;
  }

  get<T>(path: string, query?: Record<string, unknown>, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET', query });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}
