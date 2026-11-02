import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, t } from '../../core/db.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { query, validate } from '../../middleware/validate.js';
import { getSiteSettings } from '../settings/service.js';
import { ensureInviteCode, getInviteSummary } from './service.js';

export const invitesRouter: Router = Router();

/** 我的邀请码 + 战绩。第一次访问时才生成码，老用户无需回填。 */
invitesRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await getSiteSettings();
    const [code, summary] = await Promise.all([ensureInviteCode(req.auth!.id), getInviteSummary(req.auth!.id)]);
    ok(res, {
      enabled: settings.inviteEnabled,
      rewardDays: settings.inviteRewardDays,
      code,
      invited: summary.invited,
      daysEarned: summary.daysEarned,
      lastInvitedAt: summary.lastInvitedAt,
    });
  }),
);

/**
 * 注册页用来显示"XXX 邀请你加入"。
 * 只暴露邀请人的昵称，不暴露 id / 邮箱。
 */
invitesRouter.get(
  '/validate',
  validate({ query: z.object({ code: z.string().trim().min(1).max(16) }) }),
  asyncHandler(async (req, res) => {
    const { code } = query<{ code: string }>(req);
    const [row] = await db
      .select({ displayName: t.users.displayName, username: t.users.username })
      .from(t.inviteCodes)
      .innerJoin(t.users, eq(t.users.id, t.inviteCodes.userId))
      .where(eq(t.inviteCodes.code, code.trim().toUpperCase()))
      .limit(1);

    const settings = await getSiteSettings();
    ok(res, {
      valid: Boolean(row) && settings.inviteEnabled,
      inviterName: row ? row.displayName || row.username : null,
      rewardDays: settings.inviteRewardDays,
    });
  }),
);
