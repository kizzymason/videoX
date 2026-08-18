import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { redeemSchema } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { redeemLimiter } from '../../middleware/request-context.js';
import { body, validate } from '../../middleware/validate.js';
import { recordAnalyticsServerEvent } from '../analytics/service.js';
import { getMySubscriptions, listPlans, redeemCode } from './service.js';

export const membershipRouter: Router = Router();

membershipRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    ok(res, await listPlans(true));
  }),
);

membershipRouter.post(
  '/redeem',
  requireAuth,
  redeemLimiter,
  validate({ body: redeemSchema }),
  asyncHandler(async (req, res) => {
    const { code } = body<{ code: string }>(req);
    const result = await redeemCode({ code, userId: req.auth!.id });
    void recordAnalyticsServerEvent({ event: 'redeem', userId: req.auth!.id });
    ok(res, result, `开通成功，会员有效期至 ${result.vipExpiresAt.slice(0, 10)}`);
  }),
);

membershipRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db
      .select({ vipExpiresAt: t.users.vipExpiresAt, role: t.users.role })
      .from(t.users)
      .where(eq(t.users.id, req.auth!.id))
      .limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    const isVip = user.role === 'admin' || (user.vipExpiresAt !== null && user.vipExpiresAt.getTime() > Date.now());
    const subscriptions = await getMySubscriptions(req.auth!.id);

    ok(res, {
      isVip,
      vipExpiresAt: user.vipExpiresAt?.toISOString() ?? null,
      daysRemaining: user.vipExpiresAt
        ? Math.max(0, Math.ceil((user.vipExpiresAt.getTime() - Date.now()) / 86_400_000))
        : 0,
      subscriptions,
    });
  }),
);

membershipRouter.get(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: t.orders.id,
        orderNo: t.orders.orderNo,
        planName: t.plans.name,
        amountCents: t.orders.amountCents,
        source: t.orders.source,
        status: t.orders.status,
        createdAt: t.orders.createdAt,
      })
      .from(t.orders)
      .leftJoin(t.plans, eq(t.plans.id, t.orders.planId))
      .where(eq(t.orders.userId, req.auth!.id))
      .orderBy(t.orders.createdAt)
      .limit(100);

    ok(
      res,
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })).reverse(),
    );
  }),
);
