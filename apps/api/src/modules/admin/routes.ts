import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  aiProfileSchema,
  algoWeightsSchema,
  bannerSchema,
  bulkVideoActionSchema,
  categorySchema,
  commentListQuerySchema,
  generateCodesSchema,
  grantVipSchema,
  orderQuerySchema,
  paginationSchema,
  planSchema,
  rangeQuerySchema,
  redeemCodeQuerySchema,
  siteSettingsSchema,
  storageProfileSchema,
  updateUserAdminSchema,
  updateVideoSchema,
  userAdminQuerySchema,
  videoListQuerySchema,
} from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, params, query, validate } from '../../middleware/validate.js';
import { getAiQueue, getTranscodeQueue } from '../../core/queue.js';
import { invalidate } from '../../core/redis.js';
import {
  getAlgoWeights,
  getSiteSettings,
  saveAlgoWeights,
  saveSiteSettings,
} from '../settings/service.js';
import {
  activateStorageProfile,
  createStorageProfile,
  deleteStorageProfile,
  listStorageProfiles,
  testStorageProfile,
} from '../storage/service.js';
import { getStorage } from '../storage/service.js';
import {
  generateCodes,
  codesToCsv,
  grantVip,
  listPlans,
  revokeVip,
  toOrder,
  toPlan,
  toRedeemCode,
} from '../membership/service.js';
import {
  generateUniqueSlug,
  listVideos,
  refreshCategoryCounts,
  requireVideo,
  syncVideoTags,
} from '../videos/service.js';
import { enqueueTranscode } from '../uploads/service.js';
import { getVideoRetention, getVisitorInsights } from '../analytics/service.js';
import { aggregateDailyStats, getDashboardOverview, getTopVideos } from './dashboard.js';
import { audit, listAuditLogs } from './audit.js';
import { invalidateMediaCache } from '../media/routes.js';

export const adminRouter: Router = Router();

adminRouter.use(requireAuth, requireAdmin);

const idParam = z.object({ id: z.string().min(1).max(64) });

// ==========================================================================
// 仪表盘
// ==========================================================================

adminRouter.get(
  '/dashboard/overview',
  asyncHandler(async (_req, res) => {
    ok(res, await getDashboardOverview());
  }),
);

adminRouter.get(
  '/dashboard/insights',
  validate({ query: rangeQuerySchema }),
  asyncHandler(async (req, res) => {
    const { days } = query<{ days: number }>(req);
    ok(res, await getVisitorInsights(days));
  }),
);

adminRouter.get(
  '/dashboard/top-videos',
  validate({ query: rangeQuerySchema }),
  asyncHandler(async (req, res) => {
    const { days } = query<{ days: number }>(req);
    ok(res, await getTopVideos(days));
  }),
);

adminRouter.get(
  '/dashboard/retention/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    ok(res, await getVideoRetention(params<{ id: string }>(req).id));
  }),
);

adminRouter.post(
  '/dashboard/aggregate',
  asyncHandler(async (req, res) => {
    await aggregateDailyStats(7);
    await audit(req, 'stats.aggregate');
    ok(res, null, '统计已重新聚合');
  }),
);

// ==========================================================================
// 视频管理
// ==========================================================================

adminRouter.get(
  '/videos',
  validate({ query: videoListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<Parameters<typeof listVideos>[0]>(req);
    const result = await listVideos({ ...q, adminView: true });
    ok(res, paginated(result.items, result.total, q.page, q.pageSize));
  }),
);

adminRouter.patch(
  '/videos/:id',
  validate({ params: idParam, body: updateVideoSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<Record<string, unknown>>(req);
    const video = await requireVideo(id);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'title',
      'description',
      'categoryId',
      'accessLevel',
      'visibility',
      'kind',
      'posterUrl',
      'verticalPosterUrl',
    ]) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.publishedAt !== undefined) {
      patch.publishedAt = input.publishedAt ? new Date(input.publishedAt as string) : null;
    }
    if (typeof input.title === 'string' && input.title !== video.title) {
      patch.slug = await generateUniqueSlug(input.title, video.id);
    }
    // 改成会员视频后新转码的产物才会加密，这里同步标记供转码任务读取。
    if (input.accessLevel !== undefined) patch.isEncrypted = input.accessLevel === 'vip';

    const [updated] = await db.update(t.videos).set(patch).where(eq(t.videos.id, video.id)).returning();

    if (Array.isArray(input.tags)) await syncVideoTags(video.id, input.tags as string[]);
    await refreshCategoryCounts([video.categoryId, (input.categoryId as string) ?? null]);

    invalidateMediaCache(video.id);
    await audit(req, 'video.update', { type: 'video', id: video.id }, { patch });
    ok(res, updated, '视频已更新');
  }),
);

adminRouter.delete(
  '/videos/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const video = await requireVideo(id);

    const storage = await getStorage();
    // 先删存储再删记录：反过来的话失败会留下无主文件。
    await storage.deletePrefix(`hls/${video.id}`).catch(() => 0);
    await storage.deletePrefix(`assets/${video.id}`).catch(() => 0);
    if (video.sourceKey) await storage.delete(video.sourceKey).catch(() => undefined);

    await db.delete(t.videos).where(eq(t.videos.id, video.id));
    await refreshCategoryCounts([video.categoryId]);
    invalidateMediaCache(video.id);

    await audit(req, 'video.delete', { type: 'video', id: video.id }, { title: video.title });
    ok(res, null, '视频已删除');
  }),
);

adminRouter.post(
  '/videos/:id/retranscode',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const video = await requireVideo(id);
    if (!video.sourceKey) throw AppError.badRequest('该视频没有源文件，无法重新转码');

    const jobId = await enqueueTranscode(video.id, video.sourceKey, video.accessLevel === 'vip');
    await audit(req, 'video.retranscode', { type: 'video', id: video.id });
    ok(res, { jobId }, '已重新加入转码队列');
  }),
);

adminRouter.post(
  '/videos/bulk',
  validate({ body: bulkVideoActionSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      ids: string[];
      action: string;
      accessLevel?: 'free' | 'login' | 'vip';
      categoryId?: string | null;
      kind?: 'vod' | 'shorts';
    }>(req);

    let affected = 0;

    switch (input.action) {
      case 'publish': {
        const result = await db
          .update(t.videos)
          .set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      case 'unpublish': {
        const result = await db
          .update(t.videos)
          .set({ visibility: 'private', updatedAt: new Date() })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      case 'archive': {
        const result = await db
          .update(t.videos)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      case 'set_access': {
        if (!input.accessLevel) throw AppError.badRequest('缺少 accessLevel');
        const result = await db
          .update(t.videos)
          .set({
            accessLevel: input.accessLevel,
            isEncrypted: input.accessLevel === 'vip',
            updatedAt: new Date(),
          })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      case 'set_category': {
        const result = await db
          .update(t.videos)
          .set({ categoryId: input.categoryId ?? null, updatedAt: new Date() })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        await refreshCategoryCounts([input.categoryId ?? null]);
        break;
      }
      case 'set_kind': {
        if (!input.kind) throw AppError.badRequest('缺少 kind');
        const result = await db
          .update(t.videos)
          .set({ kind: input.kind, updatedAt: new Date() })
          .where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      case 'retranscode': {
        const rows = await db
          .select({ id: t.videos.id, sourceKey: t.videos.sourceKey, accessLevel: t.videos.accessLevel })
          .from(t.videos)
          .where(inArray(t.videos.id, input.ids));
        for (const row of rows) {
          if (row.sourceKey) {
            await enqueueTranscode(row.id, row.sourceKey, row.accessLevel === 'vip');
            affected += 1;
          }
        }
        break;
      }
      case 'delete': {
        const storage = await getStorage();
        for (const id of input.ids) {
          await storage.deletePrefix(`hls/${id}`).catch(() => 0);
          await storage.deletePrefix(`assets/${id}`).catch(() => 0);
          invalidateMediaCache(id);
        }
        const result = await db.delete(t.videos).where(inArray(t.videos.id, input.ids));
        affected = result.rowCount ?? input.ids.length;
        break;
      }
      default:
        throw AppError.badRequest('不支持的批量操作');
    }

    for (const id of input.ids) invalidateMediaCache(id);
    await audit(req, `video.bulk.${input.action}`, undefined, { count: affected });
    ok(res, { affected }, `已处理 ${affected} 条`);
  }),
);

/** 转码队列总览 */
adminRouter.get(
  '/transcode/jobs',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: t.transcodeJobs.id,
          videoId: t.transcodeJobs.videoId,
          videoTitle: t.videos.title,
          status: t.transcodeJobs.status,
          progress: t.transcodeJobs.progress,
          stage: t.transcodeJobs.stage,
          currentRendition: t.transcodeJobs.currentRendition,
          completedRenditions: t.transcodeJobs.completedRenditions,
          errorMessage: t.transcodeJobs.errorMessage,
          attempts: t.transcodeJobs.attempts,
          startedAt: t.transcodeJobs.startedAt,
          finishedAt: t.transcodeJobs.finishedAt,
          createdAt: t.transcodeJobs.createdAt,
        })
        .from(t.transcodeJobs)
        .leftJoin(t.videos, eq(t.videos.id, t.transcodeJobs.videoId))
        .orderBy(desc(t.transcodeJobs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(t.transcodeJobs),
    ]);

    ok(
      res,
      paginated(
        rows.map((r) => ({
          ...r,
          videoTitle: r.videoTitle ?? '(已删除)',
          startedAt: r.startedAt?.toISOString() ?? null,
          finishedAt: r.finishedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      ),
    );
  }),
);

/**
 * 转码进度 SSE。前端开一条长连接，服务端每 2 秒推一次进行中的任务快照。
 * 相比 WebSocket，SSE 在只需单向推送时更简单、也能自动重连。
 */
adminRouter.get(
  '/transcode/stream',
  asyncHandler(async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const push = async () => {
      if (closed) return;
      const rows = await db
        .select({
          id: t.transcodeJobs.id,
          videoId: t.transcodeJobs.videoId,
          videoTitle: t.videos.title,
          status: t.transcodeJobs.status,
          progress: t.transcodeJobs.progress,
          stage: t.transcodeJobs.stage,
          currentRendition: t.transcodeJobs.currentRendition,
          completedRenditions: t.transcodeJobs.completedRenditions,
          errorMessage: t.transcodeJobs.errorMessage,
        })
        .from(t.transcodeJobs)
        .leftJoin(t.videos, eq(t.videos.id, t.transcodeJobs.videoId))
        .where(sql`${t.transcodeJobs.status} not in ('completed','canceled')`)
        .orderBy(desc(t.transcodeJobs.createdAt))
        .limit(30);

      if (!closed) res.write(`data: ${JSON.stringify(rows)}\n\n`);
    };

    await push();
    const timer = setInterval(() => {
      void push().catch(() => undefined);
    }, 2000);

    req.on('close', () => {
      clearInterval(timer);
      res.end();
    });
  }),
);

adminRouter.post(
  '/transcode/jobs/:id/cancel',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const [job] = await db.select().from(t.transcodeJobs).where(eq(t.transcodeJobs.id, id)).limit(1);
    if (!job) throw AppError.notFound('任务不存在');

    const queueJob = await getTranscodeQueue().getJob(job.queueJobId ?? job.id);
    await queueJob?.remove().catch(() => undefined);

    await db
      .update(t.transcodeJobs)
      .set({ status: 'canceled', finishedAt: new Date() })
      .where(eq(t.transcodeJobs.id, id));

    await audit(req, 'transcode.cancel', { type: 'job', id });
    ok(res, null, '任务已取消');
  }),
);

// ==========================================================================
// 用户管理
// ==========================================================================

adminRouter.get(
  '/users',
  validate({ query: userAdminQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      q?: string;
      role?: 'user' | 'vip' | 'admin';
      status?: 'active' | 'banned';
      vipOnly?: boolean;
    }>(req);

    const filters = [];
    if (q.q) {
      filters.push(
        sql`(${t.users.username} ILIKE ${'%' + q.q + '%'} OR ${t.users.email} ILIKE ${'%' + q.q + '%'} OR ${t.users.displayName} ILIKE ${'%' + q.q + '%'}` + `)`,
      );
    }
    if (q.role) filters.push(eq(t.users.role, q.role));
    if (q.status) filters.push(eq(t.users.status, q.status));
    if (q.vipOnly) filters.push(sql`${t.users.vipExpiresAt} > now()`);

    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: t.users.id,
          email: t.users.email,
          username: t.users.username,
          displayName: t.users.displayName,
          avatarUrl: t.users.avatarUrl,
          role: t.users.role,
          status: t.users.status,
          vipExpiresAt: t.users.vipExpiresAt,
          videoCount: t.users.videoCount,
          followerCount: t.users.followerCount,
          lastLoginAt: t.users.lastLoginAt,
          createdAt: t.users.createdAt,
        })
        .from(t.users)
        .where(where)
        .orderBy(desc(t.users.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(t.users).where(where),
    ]);

    ok(
      res,
      paginated(
        rows.map((r) => ({
          ...r,
          isVip: r.role === 'admin' || (r.vipExpiresAt !== null && r.vipExpiresAt.getTime() > Date.now()),
          vipExpiresAt: r.vipExpiresAt?.toISOString() ?? null,
          lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        Number(countRows[0]?.total ?? 0),
        q.page,
        q.pageSize,
      ),
    );
  }),
);

adminRouter.patch(
  '/users/:id',
  validate({ params: idParam, body: updateUserAdminSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<Record<string, unknown>>(req);

    if (id === req.auth!.id && input.role && input.role !== 'admin') {
      throw AppError.badRequest('不能取消自己的管理员权限');
    }

    const [updated] = await db
      .update(t.users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(t.users.id, id))
      .returning({ id: t.users.id, role: t.users.role, status: t.users.status });
    if (!updated) throw AppError.notFound('用户不存在');

    // 封禁后立刻踢下线。
    if (input.status === 'banned') {
      await db
        .update(t.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(t.refreshTokens.userId, id));
    }

    await audit(req, 'user.update', { type: 'user', id }, input);
    ok(res, updated, '用户已更新');
  }),
);

adminRouter.post(
  '/users/grant-vip',
  validate({ body: grantVipSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ userId: string; days: number; note?: string }>(req);
    const result = await grantVip({ ...input, operatorId: req.auth!.id });
    await audit(req, 'user.grant_vip', { type: 'user', id: input.userId }, { days: input.days });
    ok(res, result, `已赠送 ${input.days} 天会员`);
  }),
);

adminRouter.post(
  '/users/:id/revoke-vip',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    await revokeVip(id);
    await audit(req, 'user.revoke_vip', { type: 'user', id });
    ok(res, null, '会员权益已收回');
  }),
);
