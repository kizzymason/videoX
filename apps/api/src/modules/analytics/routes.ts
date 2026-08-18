import { Router } from 'express';
import { analyticsBatchSchema, type AnalyticsPayload } from '@videox/shared';
import { asyncHandler, ok } from '../../core/respond.js';
import { optionalAuth } from '../../middleware/auth.js';
import { clientIp, collectLimiter } from '../../middleware/request-context.js';
import { body, validate } from '../../middleware/validate.js';
import { logger } from '../../core/logger.js';
import { collectEvents } from './service.js';

export const analyticsRouter: Router = Router();

/**
 * 埋点入口。用 sendBeacon 提交，所以要尽快返回 204，
 * 真正的落库放到响应之后异步做，避免拖慢页面卸载。
 */
analyticsRouter.post(
  '/collect',
  collectLimiter,
  optionalAuth,
  validate({ body: analyticsBatchSchema }),
  asyncHandler(async (req, res) => {
    const { events } = body<{ events: AnalyticsPayload[] }>(req);
    const ctx = {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? ''),
      userId: req.auth?.id ?? null,
    };

    res.status(204).end();

    void collectEvents(events, ctx).catch((error) => {
      logger.debug({ err: error }, '埋点落库失败');
    });
  }),
);
