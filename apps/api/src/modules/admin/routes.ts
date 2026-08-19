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
