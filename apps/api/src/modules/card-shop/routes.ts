import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { cardCheckoutSchema } from '@videox/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { cardCheckoutLimiter, cardPollLimiter } from '../../middleware/request-context.js';
import { body, params, validate } from '../../middleware/validate.js';
import {
  applyWebhook,
  createCheckout,
  getQrSource,
  listMyPurchases,
  listProducts,
  syncCheckout,
} from './service.js';
import { assertCardShopEnabled, fetchQrImage } from './upstream.js';

export const cardShopRouter: Router = Router();

const orderNoSchema = z.object({ orderNo: z.string().min(4).max(64) });

/** 入口开关：前端据此决定是否展示「购买卡密」按钮。 */
cardShopRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, { enabled: env.cardShopEnabled });
  }),
);

cardShopRouter.get(
  '/products',
  requireAuth,
  cardPollLimiter,
  asyncHandler(async (_req, res) => {
    assertCardShopEnabled();
    ok(res, await listProducts());
  }),
);

cardShopRouter.post(
  '/checkouts',
  requireAuth,
  cardCheckoutLimiter,
  validate({ body: cardCheckoutSchema }),
  asyncHandler(async (req, res) => {
    assertCardShopEnabled();
    const input = body<{ productId: string; quantity: number; email: string }>(req);
    ok(res, await createCheckout({ userId: req.auth!.id, ...input }));
  }),
);

cardShopRouter.get(
  '/checkouts/:orderNo',
  requireAuth,
  cardPollLimiter,
  validate({ params: orderNoSchema }),
  asyncHandler(async (req, res) => {
    const { orderNo } = params<{ orderNo: string }>(req);
    ok(res, await syncCheckout({ userId: req.auth!.id, orderNo }));
  }),
);

/** 二维码由后端代取再转发，浏览器里不出现上游域名。 */
cardShopRouter.get(
  '/checkouts/:orderNo/qr',
  requireAuth,
  cardPollLimiter,
  validate({ params: orderNoSchema }),
  asyncHandler(async (req, res) => {
    const { orderNo } = params<{ orderNo: string }>(req);
    const source = await getQrSource({ userId: req.auth!.id, orderNo });
    const image = await fetchQrImage(source);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(image.contentType).send(image.body);
  }),
);

cardShopRouter.get(
  '/purchases',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await listMyPurchases(req.auth!.id));
  }),
);

/**
 * 成交回调。签名头 x-jt-signature: t=<unix秒>,v1=<hmac>，
 * 必须用原始请求体验签，所以这里单独挂 express.raw
 * （app.ts 里已把这个路径从 json 解析中排除）。
 */
cardShopRouter.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '64kb' }),
  asyncHandler(async (req, res) => {
    if (!env.cardShopEnabled) throw AppError.notFound('未开放');

    const header = req.headers['x-jt-signature'];
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (typeof header !== 'string' || !raw) throw AppError.forbidden('签名缺失');

    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const [k, v] = p.trim().split('=');
        return [k ?? '', v ?? ''];
      }),
    ) as { t?: string; v1?: string };

    const timestamp = Number(parts.t);
    // 时间窗放宽到 15 分钟：上游重投与两端时钟漂移都很常见，
    // 卡太死会把正常的成交通知拒掉。防重放仍由签名与幂等落库兜住。
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 900) {
      throw AppError.forbidden('签名已过期');
    }

    const expected = createHmac('sha256', env.cardShopWebhookSecret)
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1 ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw AppError.forbidden('签名校验失败');

    try {
      const event = JSON.parse(raw) as { event: string; data: Record<string, string> };
      await applyWebhook(event);
    } catch (error) {
      // 回调只是加速，失败不必让上游重试到底：买家侧轮询仍会把状态拉正。
      logger.warn({ err: error }, '卡密成交回调处理失败');
    }

    ok(res, null);
  }),
);
