import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../core/respond.js';
import { optionalAuth } from '../../middleware/auth.js';
import { query, validate } from '../../middleware/validate.js';
import { recommendVideos, recordImpressions } from './service.js';

export const recommendRouter: Router = Router();

const feedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(24),
  exclude: z.string().max(2000).optional(),
  immersive: z.coerce.boolean().optional(),
});

/** 个性化推荐流。游客也能调用，走热门 + 新鲜双路召回。 */
recommendRouter.get(
  '/feed',
  optionalAuth,
  validate({ query: feedQuery }),
  asyncHandler(async (req, res) => {
    const q = query<{ limit: number; exclude?: string; immersive?: boolean }>(req);
    const excludeIds = (q.exclude ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 100);

    const items = await recommendVideos({
      userId: req.auth?.id ?? null,
      limit: q.limit,
      excludeIds,
      boostDiversity: q.immersive,
    });

    if (req.auth && items.length > 0) {
      void recordImpressions(req.auth.id, items.map((v) => v.id));
    }

    ok(res, items);
  }),
);
