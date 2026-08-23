import { Router } from 'express';
import { z } from 'zod';
import {
  bulkIdsSchema,
  generatePartnerCodesSchema,
  partnerCodeQuerySchema,
  partnerCustomerQuerySchema,
  partnerGrantSchema,
} from '@videox/shared';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAuth, requirePartner } from '../../middleware/auth.js';
import { body, params, query, validate } from '../../middleware/validate.js';
import { codesToCsv } from '../membership/service.js';
import {
  deletePartnerUnusedCodes,
  disablePartnerCode,
  generatePartnerCodes,
  getPartnerOverview,
  getPartnerProfile,
  listPartnerCodes,
  listPartnerCustomers,
  partnerGrantVip,
} from './service.js';

export const partnerRouter: Router = Router();

partnerRouter.use(requireAuth, requirePartner);

const idParam = z.object({ id: z.string().min(1).max(64) });

partnerRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    ok(res, await getPartnerProfile(req.auth!.id));
  }),
);

partnerRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    ok(res, await getPartnerOverview(req.auth!.id));
  }),
);

partnerRouter.get(
  '/customers',
  validate({ query: partnerCustomerQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; pageSize: number; q?: string; expiry?: 'all' | 'active' | 'expiring' | 'expired' }>(req);
    const { items, total } = await listPartnerCustomers({
      partnerUserId: req.auth!.id,
      page: q.page,
      pageSize: q.pageSize,
      q: q.q,
      expiry: q.expiry,
    });
    ok(res, paginated(items, total, q.page, q.pageSize));
  }),
);

partnerRouter.post(
  '/customers/:id/grant',
  validate({ params: idParam, body: partnerGrantSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const { days } = body<{ days: number }>(req);
    const result = await partnerGrantVip({ partnerUserId: req.auth!.id, customerId: id, days });
    ok(res, result, `已为客户增加 ${days} 天`);
  }),
);

partnerRouter.get(
  '/codes',
  validate({ query: partnerCodeQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; pageSize: number; status?: string; q?: string }>(req);
    const { items, total } = await listPartnerCodes({
      partnerUserId: req.auth!.id,
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      q: q.q,
    });
    ok(res, paginated(items, total, q.page, q.pageSize));
  }),
);

partnerRouter.post(
  '/codes/generate',
  validate({ body: generatePartnerCodesSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      days: number;
      count: number;
      salePriceYuan: number;
      expiresAt?: string | null;
      note?: string;
    }>(req);
    const result = await generatePartnerCodes({
      partnerUserId: req.auth!.id,
      days: input.days,
      count: input.count,
      salePriceCents: Math.round(input.salePriceYuan * 100),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      note: input.note,
    });
    ok(res, result, `已生成 ${result.codes.length} 张订阅码`);
  }),
);

partnerRouter.get(
  '/codes/export',
  validate({ query: partnerCodeQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; pageSize: number; status?: string; q?: string }>(req);
    const { items } = await listPartnerCodes({
      partnerUserId: req.auth!.id,
      page: 1,
      pageSize: 5000,
      status: q.status,
      q: q.q,
    });
    const csv = codesToCsv(items);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="partner-codes-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

partnerRouter.post(
  '/codes/:id/disable',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await disablePartnerCode({ partnerUserId: req.auth!.id, id: params<{ id: string }>(req).id });
    ok(res, null, '订阅码已停用');
  }),
);

partnerRouter.post(
  '/codes/bulk-delete',
  validate({ body: bulkIdsSchema }),
  asyncHandler(async (req, res) => {
    const { ids } = body<{ ids: string[] }>(req);
    const deleted = await deletePartnerUnusedCodes({ partnerUserId: req.auth!.id, ids });
    ok(res, { deleted }, `已删除 ${deleted} 张未使用订阅码`);
  }),
);
