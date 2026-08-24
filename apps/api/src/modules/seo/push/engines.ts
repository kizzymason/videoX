// ========================================================================
// SEO 系统 - 搜索引擎主动推送：协议层纯函数
//
// IndexNow：一次提交同时通知 Bing / Yandex / Naver / Seznam 等，
//           Bing 的索引还供 ChatGPT Search、Copilot、DuckDuckGo 使用。
// 百度：普通收录 API 推送，是百度最快的收录通道。
// Google 不支持推送协议，靠 sitemap + 结构化数据（见 routes.ts / render.ts）。
// ========================================================================

import { randomBytes } from 'node:crypto';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const BAIDU_PUSH_ENDPOINT = 'http://data.zz.baidu.com/urls';

/** IndexNow 单次上限 10000，百度建议小批多次；统一用保守批量。 */
export const INDEXNOW_BATCH_SIZE = 500;
export const BAIDU_BATCH_SIZE = 100;

export function generateIndexNowKey(): string {
  // 协议要求 8-128 位十六进制/字母数字；32 位十六进制足够。
  return randomBytes(16).toString('hex');
}

export function isValidIndexNowKey(key: string): boolean {
  return /^[a-zA-Z0-9-]{8,128}$/.test(key);
}

/** 去掉尾部斜杠的站点源，如 https://example.com */
export function normalizeSiteOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 把站内路径 / 完整 URL 统一成本站绝对 URL：
 * - 相对路径拼上站点源；
 * - 绝对 URL 必须属于本站，防止误把外链推给搜索引擎；
 * - 去重、丢弃空值。
 */
export function toAbsoluteUrls(inputs: readonly string[], origin: string): string[] {
  const base = normalizeSiteOrigin(origin);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of inputs) {
    const item = raw.trim();
    if (!item) continue;
    let url: string;
    if (/^https?:\/\//i.test(item)) {
      if (!item.startsWith(`${base}/`) && item !== base) continue;
      url = item;
    } else {
      url = `${base}${item.startsWith('/') ? '' : '/'}${item}`;
    }
    if (url.length > 600) continue;
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export interface IndexNowRequest {
  endpoint: string;
  payload: {
    host: string;
    key: string;
    keyLocation: string;
    urlList: string[];
  };
}

export function buildIndexNowRequest(origin: string, key: string, urls: string[]): IndexNowRequest {
  const base = normalizeSiteOrigin(origin);
  const host = base.replace(/^https?:\/\//i, '');
  return {
    endpoint: INDEXNOW_ENDPOINT,
    payload: {
      host,
      key,
      keyLocation: `${base}/${key}.txt`,
      urlList: urls,
    },
  };
}

export interface BaiduPushRequest {
  url: string;
  body: string;
}

export function buildBaiduPushRequest(site: string, token: string, urls: string[]): BaiduPushRequest {
  const normalizedSite = normalizeSiteOrigin(site);
  const params = new URLSearchParams({ site: normalizedSite, token });
  return {
    url: `${BAIDU_PUSH_ENDPOINT}?${params.toString()}`,
    body: urls.join('\n'),
  };
}

export interface EngineResponse {
  ok: boolean;
  message: string;
}

/** IndexNow：200/202 都算受理成功。 */
export function parseIndexNowResponse(httpStatus: number, text: string): EngineResponse {
  if (httpStatus === 200 || httpStatus === 202) return { ok: true, message: `受理成功（HTTP ${httpStatus}）` };
  const known: Record<number, string> = {
    400: '请求格式错误',
    403: 'key 校验失败，请确认 {key}.txt 可公开访问',
    422: 'URL 与 host 不匹配或 key 位置错误',
    429: '推送过于频繁，被限流',
  };
  return { ok: false, message: `${known[httpStatus] ?? '推送失败'}（HTTP ${httpStatus}）${text.slice(0, 200)}` };
}

/** 百度返回 JSON：{ success, remain } 或 { error, message }。 */
export function parseBaiduResponse(httpStatus: number, text: string): EngineResponse & { remain?: number } {
  let parsed: { success?: number; remain?: number; error?: number; message?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // 非 JSON 响应按失败处理
  }
  if (httpStatus === 200 && typeof parsed.success === 'number') {
    return {
      ok: true,
      remain: parsed.remain,
      message: `成功提交 ${parsed.success} 条，今日剩余配额 ${parsed.remain ?? '未知'}`,
    };
  }
  const detail = parsed.message ?? text.slice(0, 200);
  return { ok: false, message: `百度推送失败（HTTP ${httpStatus}）：${detail}` };
}
