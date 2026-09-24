// ========================================================================
// 上游卡密渠道客户端。
//
// 这是全站唯一持有渠道密钥的地方：密钥只在这里读环境变量、只出现在
// Authorization 头里，既不下发浏览器，也不进日志。前端一律只跟
// /api/card-shop 说话，因此买家浏览器里不会出现上游域名。
// ========================================================================

import { env } from '../../config/env.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

/** 上游错误码 → 给买家看的中文。没列到的一律走兜底文案。 */
const ERROR_MESSAGES: Record<string, string> = {
  CARD_OUT_OF_STOCK: '该规格暂时售罄，请稍后再试或换一个规格',
  CARD_QUANTITY_LIMIT: '超过该规格的单次购买上限',
  MERCHANT_PRODUCT_FORBIDDEN: '该规格当前不可售',
  MERCHANT_IP_FORBIDDEN: '支付通道拒绝了本次请求，请联系管理员',
  MERCHANT_RETURN_URL_FORBIDDEN: '支付回跳地址未登记，请联系管理员',
  PAYMENT_METHOD_INVALID: '支付方式暂不可用，请稍后再试',
  FORBIDDEN: '今日购买额度已用完，请明天再试',
  UNAUTHORIZED: '支付通道未配置正确，请联系管理员',
};

export interface UpstreamProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  perOrderLimit: number;
  stock: number;
}

export interface UpstreamCheckout {
  orderNo: string;
  amount: string;
  payUrl?: string | null;
  qrcode?: string | null;
  img?: string | null;
  replayed?: boolean;
}

export interface UpstreamOrder {
  orderNo: string;
  status: string;
  amount?: string;
  codes?: string[] | null;
}

export function assertCardShopEnabled(): void {
  if (!env.cardShopEnabled) throw AppError.notFound('卡密购买暂未开放');
}

async function call<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  assertCardShopEnabled();
  const controller = new AbortController();
  // 支付通道偶发慢响应很常见，超时给得宽一点，别把还能成的请求掐掉。
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetch(`${env.JT_CARD_API_BASE.replace(/\/+$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env.JT_CHANNEL_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const data = (payload ?? {}) as { code?: string; message?: string };
      // 只记错误码与 HTTP 状态：响应体里可能带卡密，不该落进日志。
      logger.warn({ path, status: response.status, upstreamCode: data.code }, '上游卡密接口返回错误');
      const message = (data.code && ERROR_MESSAGES[data.code]) || '支付通道繁忙，请稍后再试';
      throw new AppError({
        message,
        code: ErrorCode.UPSTREAM_ERROR,
        status: response.status === 429 ? 429 : 502,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const aborted = error instanceof Error && error.name === 'AbortError';
    logger.warn({ path, err: aborted ? 'timeout' : error }, '上游卡密接口调用失败');
    throw new AppError({
      message: aborted ? '支付通道响应超时，请稍后再试' : '支付通道暂时不可用，请稍后再试',
      code: ErrorCode.UPSTREAM_ERROR,
      status: 502,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProducts(): Promise<UpstreamProduct[]> {
  const data = await call<{ items?: UpstreamProduct[] }>('/products');
  return data.items ?? [];
}

export async function createUpstreamCheckout(input: {
  productId: string;
  quantity: number;
  email: string;
  reference: string;
}): Promise<UpstreamCheckout> {
  return call<UpstreamCheckout>('/checkouts', {
    method: 'POST',
    body: {
      productId: input.productId,
      quantity: input.quantity,
      email: input.email,
      reference: input.reference,
      method: 'alipay',
      returnUrl: env.cardShopReturnUrl,
    },
    timeoutMs: 25_000,
  });
}

export async function fetchUpstreamOrder(orderNo: string): Promise<UpstreamOrder> {
  return call<UpstreamOrder>(`/checkouts/${encodeURIComponent(orderNo)}`);
}

/**
 * 取二维码图片字节。上游给的可能是 data URI、也可能是它自己域名下的外链，
 * 后者若让浏览器直连就把上游域名暴露了，所以统一由后端取回再转发。
 */
export async function fetchQrImage(source: string): Promise<{ body: Buffer; contentType: string }> {
  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(source);
    if (!match) throw AppError.badRequest('二维码格式无法识别');
    const [, contentType, base64Flag, data] = match;
    return {
      body: Buffer.from(base64Flag ? data! : decodeURIComponent(data!), base64Flag ? 'base64' : 'utf8'),
      contentType: contentType || 'image/png',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok) throw AppError.badRequest('二维码获取失败');
    const buffer = Buffer.from(await response.arrayBuffer());
    return { body: buffer, contentType: response.headers.get('content-type') ?? 'image/png' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({ message: '二维码获取失败，请刷新重试', code: ErrorCode.UPSTREAM_ERROR, status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
