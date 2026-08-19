import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { PLAYABLE_VIDEO_STATUSES } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, params, validate } from '../../middleware/validate.js';
import { refreshCategoryCounts, requireVideo } from '../videos/service.js';
import { audit } from './audit.js';
import { invalidateMediaCache } from '../media/routes.js';

export const publishGateRouter: Router = Router();

publishGateRouter.use(requireAuth, requireAdmin);

const idParam = z.object({ id: z.string().min(1).max(64) });
const rejectBody = z.object({ reason: z.string().trim().max(500).optional() });

publishGateRouter.post(
  '/videos/:id/approve',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const video = await requireVideo(id);
    if (!PLAYABLE_VIDEO_STATUSES.includes(video.status)) {
      throw AppError.badRequest('视频尚未转码完成，不能上架');
    }

    const [updated] = await db
      .update(t.videos)
      .set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(t.videos.id, video.id))
      .returning();

    await refreshCategoryCounts([video.categoryId]);
    invalidateMediaCache(video.id);
    await audit(req, 'video.approve', { type: 'video', id: video.id });
    ok(res, updated, '已通过，视频进入前台');
  }),
);

publishGateRouter.post(
  '/videos/:id/reject',
  validate({ params: idParam, body: rejectBody }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const { reason } = body<{ reason?: string }>(req);
    const video = await requireVideo(id);

    const [updated] = await db
      .update(t.videos)
      .set({ status: 'archived', visibility: 'private', updatedAt: new Date() })
      .where(eq(t.videos.id, video.id))
      .returning();

    await refreshCategoryCounts([video.categoryId]);
    invalidateMediaCache(video.id);
    await audit(req, 'video.reject', { type: 'video', id: video.id }, reason ? { reason } : undefined);
    ok(res, updated, '已拒绝，视频不进入前台');
  }),
);
