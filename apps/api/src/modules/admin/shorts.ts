import { Router } from 'express';
import { videoListQuerySchema } from '@videox/shared';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { query, validate } from '../../middleware/validate.js';
import { listVideos } from '../videos/service.js';

export const adminShortsRouter: Router = Router();
adminShortsRouter.use(requireAuth, requireAdmin);
adminShortsRouter.get('/', validate({ query: videoListQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<Parameters<typeof listVideos>[0]>(req);
  const result = await listVideos({ ...q, adminView: true, kind: 'shorts' });
  ok(res, paginated(result.items, result.total, q.page, q.pageSize));
}));
