// ========================================================================
// Yitongkan API 客户端（支持 AES-256-GCM 加密）
// ========================================================================

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Buffer } from 'buffer';

const KEY = hexToBytes('6bfd71bcc816c01a904ea112d65e18677ee421f5e45b3fc1b8c62a7303ddc93a');

/**
 * Hex string → Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * AES-256-GCM 加密
 * 格式与 caiji/test_final.py 对齐：base64(iv[12B] + ciphertext + authTag[16B])，authTag 拼在末尾
 */
function encrypt(data: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);

  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

/**
 * AES-256-GCM 解密（标准 AESGCM 格式，authTag 在密文末尾）
 */
function decrypt(encryptedData: string): Record<string, unknown> {
  const buf = Buffer.from(encryptedData.trim(), 'base64');
  const iv = buf.subarray(0, 12);
  const ctWithTag = buf.subarray(12);
  const authTag = ctWithTag.subarray(ctWithTag.length - 16);
  const ciphertext = ctWithTag.subarray(0, ctWithTag.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// --------------------------------------------------------------------------
// API 客户端
// --------------------------------------------------------------------------

interface AccountCredentials {
  uid: string;
  token: string;
}

export interface YitongKanLoginResult {
  uid: string;
  token: string;
  username: string;
  isVip: boolean;
  vipExpiresAt?: string;
}

/**
 * 源站列表原始响应结构（实测 2026-08：items/cover/filters.count）
 */
interface RawListResponse {
  code: string;
  message: string;
  data?: {
    section?: string;
    items?: Array<{
      id: number;
      title: string;
      cover?: string;
      duration?: number;
    }>;
    filters?: Array<{ value: string; label: string; count: number }>;
    total?: number;
  };
}

export class YitongKanApiClient {
  private readonly API_BASE = 'https://ytk-api.yitongcs.com';
  private credentials: AccountCredentials | null = null;
  
  constructor(credentials?: AccountCredentials) {
    if (credentials) {
      this.credentials = credentials;
    }
  }

  /**
   * 登录源站并取得当前 token。登录响应可能是明文 JSON 或 AES-GCM。
   * 实测只有 data.token + data.user.{id,username,isVIP,vipTime}，没有 expires/ttl；
   * vipTime 是会员到期，不是 session 过期。有效性以 getMemberInfo()（/me）为准。
   */
  static async login(username: string, password: string): Promise<YitongKanLoginResult> {
    const response = await fetch('https://ytk-api.yitongcs.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Referer: 'https://yitongkan.com/',
        Origin: 'https://yitongkan.com',
      },
      body: JSON.stringify({ username, password }),
    });

    const raw = Buffer.from(await response.arrayBuffer());
    const text = raw.toString('utf8');
    let payload: {
      code?: string | number;
      message?: string;
      data?: { token?: string; user?: { id?: number | string; username?: string; isVIP?: boolean; vipTime?: number } };
    };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      payload = decrypt(text) as typeof payload;
    }

    if (!response.ok || String(payload.code) !== '200' || !payload.data?.token || !payload.data.user?.id) {
      throw new Error(payload.message || `源站登录失败（HTTP ${response.status}）`);
    }

    const user = payload.data.user;
    return {
      uid: String(user.id),
      token: payload.data.token,
      username: user.username || username,
      isVip: Boolean(user.isVIP),
      vipExpiresAt: user.vipTime ? new Date(user.vipTime * 1000).toISOString() : undefined,
    };
  }
  
  /**
   * 设置/更新账号凭证
   */
  setCredentials(uid: string, token: string): void {
    this.credentials = { uid, token };
  }
  
  /**
   * 获取 Bearer Token
   */
  private getAuthorizationHeader(): string | null {
    if (!this.credentials) return null;
    const bearer = Buffer.from(`${this.credentials.uid}:${this.credentials.token}`).toString('base64');
    return `Bearer ${bearer}`;
  }
  
  /**
   * GET 请求（自动处理加密响应）
   */
  async get<T = Record<string, unknown>>(path: string, authRequired = false): Promise<T> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      Referer: 'https://yitongkan.com/',
      Origin: 'https://yitongkan.com',
    };

    if (authRequired) {
      const auth = this.getAuthorizationHeader();
      if (!auth) throw new Error('No credentials');
      headers['Authorization'] = auth;
    }

    const response = await fetch(`${this.API_BASE}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const raw = Buffer.from(await response.arrayBuffer());
    const text = raw.toString('utf8');

    // 响应可能是普通 JSON 或 AES-GCM base64 密文
    try {
      return JSON.parse(text) as T;
    } catch {
      return decrypt(text) as T;
    }
  }
  
  /**
   * POST 请求（自动处理加密请求和响应）
   * 与 caiji/test_final.py 对齐：Content-Type: text/plain + X-Enc: aes-gcm/v1
   */
  async post<T = Record<string, unknown>>(path: string, data: Record<string, unknown>, authRequired = false): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      'X-Enc': 'aes-gcm/v1',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      Referer: 'https://yitongkan.com/',
      Origin: 'https://yitongkan.com',
    };

    if (authRequired) {
      const auth = this.getAuthorizationHeader();
      if (!auth) throw new Error('No credentials');
      headers['Authorization'] = auth;
    }

    const encryptedBody = encrypt(data);

    const response = await fetch(`${this.API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: encryptedBody,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const raw = Buffer.from(await response.arrayBuffer());
    const text = raw.toString('utf8');

    try {
      return JSON.parse(text) as T;
    } catch {
      return decrypt(text) as T;
    }
  }
  
  // ------------------------------------------------------------------------
  // 业务方法
  // ------------------------------------------------------------------------

  /**
   * 统一拉取列表（gv/mv/tv 同一接口格式），字段归一化为 list/coverUrl
   */
  private async fetchList(
    kind: 'gv' | 'mv' | 'tv',
    page: number,
    pageSize: number,
  ): Promise<{
    code: string;
    data: {
      list: Array<{ id: number; title: string; coverUrl: string; duration: number }>;
      total: number;
      page: number;
      pageSize: number;
    };
    message: string;
  }> {
    const queryParams = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
      sort: 'default',
    });

    const raw = await this.get<RawListResponse>(
      `/api/content/${kind}?${queryParams}`,
      true,
    );
    const items = raw.data?.items ?? [];

    return {
      code: raw.code,
      message: raw.message,
      data: {
        list: items.map((it) => ({
          id: it.id,
          title: it.title,
          coverUrl: it.cover ?? '',
          duration: it.duration ?? 0,
        })),
        // 源站无显式 total，取「全部」筛选项的 count
        total: raw.data?.filters?.find((f) => f.value === 'all')?.count ?? raw.data?.total ?? items.length,
        page,
        pageSize,
      },
    };
  }

  /**
   * 获取 GV 视频列表
   */
  async getGVList(page: number, pageSize: number = 20): Promise<{
    code: string;
    data: {
      list: Array<{ id: number; title: string; coverUrl: string; duration: number }>;
      total: number;
      page: number;
      pageSize: number;
    };
    message: string;
  }> {
    return this.fetchList('gv', page, pageSize);
  }

  /**
   * 获取 MV 视频列表
   */
  async getMVList(page: number, pageSize: number = 20): Promise<{
    code: string;
    data: {
      list: Array<{ id: number; title: string; coverUrl: string; duration: number }>;
      total: number;
      page: number;
      pageSize: number;
    };
    message: string;
  }> {
    return this.fetchList('mv', page, pageSize);
  }

  /**
   * 获取 TV 剧集列表
   */
  async getTVList(page: number, pageSize: number = 20): Promise<{
    code: string;
    data: {
      list: Array<{ id: number; title: string; coverUrl: string; duration: number }>;
      total: number;
      page: number;
      pageSize: number;
    };
    message: string;
  }> {
    return this.fetchList('tv', page, pageSize);
  }

  /**
   * 获取播放地址（需 VIP）
   */
  async getPlayUrl(videoId: number, kind: 'gv' | 'mv' | 'tv'): Promise<{
    code: string;
    data: {
      url: string;
      qualities: Array<{
        label: string;
        url: string;
        bitrate?: number;
      }>;
      videoId: number;
    };
    message: string;
  }> {
    return this.get(`/api/content/${kind}/${videoId}/play`, true);
  }

  /**
   * 检查会员状态（字段归一化：isVIP → isVip，vipTime 秒级时间戳 → vipExpiresAt ISO）
   */
  async getMemberInfo(): Promise<{
    code: string;
    data: {
      uid: number;
      username: string;
      isVip: boolean;
      vipExpiresAt?: string;
      avatarUrl?: string;
    };
    message: string;
  }> {
    const raw = await this.get<{
      code: string;
      message: string;
      data?: { id?: number; username?: string; isVIP?: boolean; vipTime?: number; avatar?: string };
    }>('/api/member/me', true);

    return {
      code: raw.code,
      message: raw.message,
      data: {
        uid: raw.data?.id ?? 0,
        username: raw.data?.username ?? '',
        isVip: raw.data?.isVIP ?? false,
        vipExpiresAt: raw.data?.vipTime
          ? new Date(raw.data.vipTime * 1000).toISOString()
          : undefined,
        avatarUrl: raw.data?.avatar || undefined,
      },
    };
  }
}

/**
 * 从现有 AccountPoolEntry 创建 API 客户端
 */
export function createClientFromAccount(account: { uid: string; token: string }): YitongKanApiClient {
  return new YitongKanApiClient({ uid: account.uid, token: account.token });
}
