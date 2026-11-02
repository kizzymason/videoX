import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, query, validate } from '../../middleware/validate.js';
import { getSiteSettings, saveSiteSettings } from '../settings/service.js';
import { getInviteOverview, listInvitations } from './service.js';

export const invitesAdminRouter: Router = Router();

invitesAdminRouter.use(requireAuth, requireAdmin);

const recordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(60).optional(),
  status: z.enum(['granted', 'rejected']).optional(),
});

/** 汇总：总邀请数、总发放天数、今日邀请、被防刷拦下的次数、邀请榜。 */
invitesAdminRouter.get(
  '/invites/overview',
  asyncHandler(async (_req, res) => {
    const settings = await getSiteSettings();
    const overview = await getInviteOverview();
    ok(res, {
      settings: { enabled: settings.inviteEnabled, rewardDays: settings.inviteRewardDays },
      ...overview,
    });
  }),
);

invitesAdminRouter.get(
  '/invites/records',
  validate({ query: recordsQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof recordsQuerySchema>>(req);
    const { rows, total } = await listInvitations(q);

    const items = rows.map((r) => ({
      id: String(r.id),
      status: String(r.status),
      reason: String(r.reason ?? ''),
      days: Number(r.days ?? 0),
      code: String(r.code ?? ''),
      inviteeIp: String(r.invitee_ip ?? ''),
      inviterIp: String(r.inviter_ip ?? ''),
      deviceHash: String(r.device_hash ?? '').slice(0, 12),
      createdAt: new Date(r.created_at as string).toISOString(),
      inviter: {
        id: String(r.inviter_id),
        username: String(r.inviter_username ?? ''),
        displayName: String(r.inviter_name ?? ''),
      },
      invitee: {
        id: String(r.invitee_id),
        username: String(r.invitee_username ?? ''),
        displayName: String(r.invitee_name ?? ''),
      },
    }));

    ok(res, paginated(items, total, q.page, q.pageSize));
  }),
);

/** 只改邀请相关的两个字段，其余站点设置按当前值透传，避免被默认值覆盖。 */
invitesAdminRouter.patch(
  '/invites/settings',
  validate({
    body: z.object({
      enabled: z.boolean().optional(),
      rewardDays: z.coerce.number().int().min(0).max(365).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{ enabled?: boolean; rewardDays?: number }>(req);
    const current = await getSiteSettings();
    const saved = await saveSiteSettings({
      ...current,
      inviteEnabled: input.enabled ?? current.inviteEnabled,
      inviteRewardDays: input.rewardDays ?? current.inviteRewardDays,
    });
    ok(res, { enabled: saved.inviteEnabled, rewardDays: saved.inviteRewardDays });
  }),
);
