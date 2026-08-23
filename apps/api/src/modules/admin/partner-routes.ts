import { Router } from 'express';
import { z } from 'zod';
import { adminPartnerQuerySchema, appointPartnerSchema, updatePartnerSchema } from '@videox/shared';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { body, params, query, validate } from '../../middleware/validate.js';
import { audit } from './audit.js';
import {
  appointPartner,
  getAdminPartnerDetail,
  listAdminPartners,
  revokePartner,
  updatePartner,
} from '../partner/service.js';

export const adminPartnerRouter: Router = Router();

const idParam = z.object({ id: z.string().min(1).max(64) });

adminPartnerRouter.get(
  '/partners',
  validate({ query: adminPartnerQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; pageSize: number; q?: string; status?: 'active' | 'revoked' }>(req);
    const { items, total } = await listAdminPartners(q);
    ok(res, paginated(items, total, q.page, q.pageSize));
  }),
);

adminPartnerRouter.post(
  '/partners',
  validate({ body: appointPartnerSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      userId: string;
      level: 'standard' | 'plus';
      codeQuota: number;
      daysQuota: number;
      note?: string | null;
    }>(req);
    const partner = await appointPartner(input);
    await audit(req, 'partner.appoint', { type: 'user', id: input.userId }, input);
    ok(res, partner, '已设为合伙人');
  }),
);

adminPartnerRouter.get(
  '/partners/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    ok(res, await getAdminPartnerDetail(params<{ id: string }>(req).id));
  }),
);

adminPartnerRouter.patch(
  '/partners/:id',
  validate({ params: idParam, body: updatePartnerSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<{
      level?: 'standard' | 'plus';
      codeQuota?: number;
      daysQuota?: number;
      note?: string | null;
    }>(req);
    const partner = await updatePartner({ userId: id, ...input });
    await audit(req, 'partner.update', { type: 'user', id }, input);
    ok(res, partner, '合伙人已更新');
  }),
);

adminPartnerRouter.post(
  '/partners/:id/revoke',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    await revokePartner(id);
    await audit(req, 'partner.revoke', { type: 'user', id });
    ok(res, null, '已取消合伙人');
  }),
);
