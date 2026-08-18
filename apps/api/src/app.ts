import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { ok } from './core/respond.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter, requestContext } from './middleware/request-context.js';
import { pingDb } from '@videox/db';

import { authRouter } from './modules/auth/routes.js';
import { videosRouter } from './modules/videos/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { commentsRouter } from './modules/comments/routes.js';
import { interactionsRouter } from './modules/interactions/routes.js';
import { uploadsRouter } from './modules/uploads/routes.js';
import { membershipRouter } from './modules/membership/routes.js';
import { recommendRouter } from './modules/recommend/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { mediaRouter } from './modules/media/routes.js';
import { seoRouter } from './modules/seo/routes.js';
import { staticRouter } from './modules/static/routes.js';

export function createApp(): Express {
  const app = express();

  // 反代后要拿到真实 IP，限流与 playToken 的 IP 绑定都依赖它。
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      // 媒体要跨端口取，默认的 CORP 会拦掉。
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // 无 origin 的请求（curl、<video> 直连、同源导航）一律放行。
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        if (!env.isProd) return callback(null, true);
        callback(new Error(`CORS 未授权的来源：${origin}`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Content-Range', 'Accept-Ranges'],
    }),
  );

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { traceId?: string }).traceId ?? '',
      autoLogging: {
        // 分片请求量极大，全部打日志会淹没有用信息。
        ignore: (req) => Boolean(req.url?.startsWith('/media/hls/')) || req.url === '/health',
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
    }),
  );

  app.use(compression({ filter: (req, res) => !req.path.startsWith('/media/hls/') && compression.filter(req, res) }));
  app.use(cookieParser(env.COOKIE_SECRET));

  // 分片上传走裸二进制，必须在 json 解析之前挂载并跳过 body 解析。
  app.use((req, res, next) => {
    if (req.method === 'PUT' && /^\/api\/uploads\/[^/]+\/part\/\d+$/.test(req.path)) return next();
    express.json({ limit: '2mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    const dbOk = await pingDb();
    res.status(dbOk ? 200 : 503).json({
      code: dbOk ? 0 : 5000,
      message: dbOk ? 'ok' : 'database unreachable',
      data: { uptime: Math.floor(process.uptime()), env: env.NODE_ENV, db: dbOk },
      traceId: _req.traceId,
    });
  });

  app.use('/api', globalLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/videos', videosRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/membership', membershipRouter);
  app.use('/api/recommend', recommendRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', interactionsRouter);
  app.use('/api', catalogRouter);

  app.use('/media', mediaRouter);
  app.use('/static', staticRouter);
  app.use('/', seoRouter);

  app.get('/', (req, res) => {
    ok(res, {
      name: 'videoX API',
      version: '1.0.0',
      docs: `${env.API_PUBLIC_URL}/health`,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
