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

adminRouter.get('/dashboard/overview', asyncHandler(async (_req, res) => { ok(res, await getDashboardOverview()); }));
adminRouter.get('/dashboard/insights', validate({ query: rangeQuerySchema }), asyncHandler(async (req, res) => { const { days } = query<{ days: number }>(req); ok(res, await getVisitorInsights(days)); }));
adminRouter.get('/dashboard/top-videos', validate({ query: rangeQuerySchema }), asyncHandler(async (req, res) => { const { days } = query<{ days: number }>(req); ok(res, await getTopVideos(days)); }));
adminRouter.get('/dashboard/retention/:id', validate({ params: idParam }), asyncHandler(async (req, res) => { ok(res, await getVideoRetention(params<{ id: string }>(req).id)); }));
adminRouter.post('/dashboard/aggregate', asyncHandler(async (req, res) => { await aggregateDailyStats(7); await audit(req, 'stats.aggregate'); ok(res, null, '统计已重新聚合'); }));

adminRouter.get('/videos', validate({ query: videoListQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<Parameters<typeof listVideos>[0]>(req);
  const result = await listVideos({ ...q, adminView: true });
  ok(res, paginated(result.items, result.total, q.page, q.pageSize));
}));

adminRouter.patch('/videos/:id', validate({ params: idParam, body: updateVideoSchema }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Record<string, unknown>>(req);
  const video = await requireVideo(id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ['title', 'description', 'categoryId', 'accessLevel', 'visibility', 'kind', 'posterUrl', 'verticalPosterUrl']) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.publishedAt !== undefined) patch.publishedAt = input.publishedAt ? new Date(input.publishedAt as string) : null;
  if (typeof input.title === 'string' && input.title !== video.title) patch.slug = await generateUniqueSlug(input.title, video.id);
  if (input.accessLevel !== undefined) patch.isEncrypted = input.accessLevel === 'vip';
  const [updated] = await db.update(t.videos).set(patch).where(eq(t.videos.id, video.id)).returning();
  if (Array.isArray(input.tags)) await syncVideoTags(video.id, input.tags as string[]);
  await refreshCategoryCounts([video.categoryId, (input.categoryId as string) ?? null]);
  invalidateMediaCache(video.id);
  await audit(req, 'video.update', { type: 'video', id: video.id }, { patch });
  ok(res, updated, '视频已更新');
}));

adminRouter.delete('/videos/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const video = await requireVideo(id);
  const storage = await getStorage();
  await storage.deletePrefix(`hls/${video.id}`).catch(() => 0);
  await storage.deletePrefix(`assets/${video.id}`).catch(() => 0);
  if (video.sourceKey) await storage.delete(video.sourceKey).catch(() => undefined);
  await db.delete(t.videos).where(eq(t.videos.id, video.id));
  await refreshCategoryCounts([video.categoryId]);
  invalidateMediaCache(video.id);
  await audit(req, 'video.delete', { type: 'video', id: video.id }, { title: video.title });
  ok(res, null, '视频已删除');
}));

adminRouter.post('/videos/:id/retranscode', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const video = await requireVideo(id);
  if (!video.sourceKey) throw AppError.badRequest('该视频没有源文件，无法重新转码');
  const jobId = await enqueueTranscode(video.id, video.sourceKey, video.accessLevel === 'vip');
  await audit(req, 'video.retranscode', { type: 'video', id: video.id });
  ok(res, { jobId }, '已重新加入转码队列');
}));

adminRouter.post('/videos/bulk', validate({ body: bulkVideoActionSchema }), asyncHandler(async (req, res) => {
  const input = body<{ ids: string[]; action: string; accessLevel?: 'free' | 'login' | 'vip'; categoryId?: string | null; kind?: 'vod' | 'shorts'; }>(req);
  let affected = 0;
  switch (input.action) {
    case 'publish': {
      const result = await db.update(t.videos).set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    case 'unpublish': {
      const result = await db.update(t.videos).set({ visibility: 'private', updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    case 'archive': {
      const result = await db.update(t.videos).set({ status: 'archived', updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    case 'set_access': {
      if (!input.accessLevel) throw AppError.badRequest('缺少 accessLevel');
      const result = await db.update(t.videos).set({ accessLevel: input.accessLevel, isEncrypted: input.accessLevel === 'vip', updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    case 'set_category': {
      const result = await db.update(t.videos).set({ categoryId: input.categoryId ?? null, updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length;
      await refreshCategoryCounts([input.categoryId ?? null]); break;
    }
    case 'set_kind': {
      if (!input.kind) throw AppError.badRequest('缺少 kind');
      const result = await db.update(t.videos).set({ kind: input.kind, updatedAt: new Date() }).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    case 'retranscode': {
      const rows = await db.select({ id: t.videos.id, sourceKey: t.videos.sourceKey, accessLevel: t.videos.accessLevel }).from(t.videos).where(inArray(t.videos.id, input.ids));
      for (const row of rows) { if (row.sourceKey) { await enqueueTranscode(row.id, row.sourceKey, row.accessLevel === 'vip'); affected += 1; } }
      break;
    }
    case 'delete': {
      const storage = await getStorage();
      for (const id of input.ids) { await storage.deletePrefix(`hls/${id}`).catch(() => 0); await storage.deletePrefix(`assets/${id}`).catch(() => 0); invalidateMediaCache(id); }
      const result = await db.delete(t.videos).where(inArray(t.videos.id, input.ids));
      affected = result.rowCount ?? input.ids.length; break;
    }
    default: throw AppError.badRequest('不支持的批量操作');
  }
  for (const id of input.ids) invalidateMediaCache(id);
  await audit(req, `video.bulk.${input.action}`, undefined, { count: affected });
  ok(res, { affected }, `已处理 ${affected} 条`);
}));

adminRouter.get('/transcode/jobs', validate({ query: paginationSchema }), asyncHandler(async (req, res) => {
  const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.transcodeJobs.id, videoId: t.transcodeJobs.videoId, videoTitle: t.videos.title, status: t.transcodeJobs.status, progress: t.transcodeJobs.progress, stage: t.transcodeJobs.stage, currentRendition: t.transcodeJobs.currentRendition, completedRenditions: t.transcodeJobs.completedRenditions, errorMessage: t.transcodeJobs.errorMessage, attempts: t.transcodeJobs.attempts, startedAt: t.transcodeJobs.startedAt, finishedAt: t.transcodeJobs.finishedAt, createdAt: t.transcodeJobs.createdAt }).from(t.transcodeJobs).leftJoin(t.videos, eq(t.videos.id, t.transcodeJobs.videoId)).orderBy(desc(t.transcodeJobs.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.transcodeJobs),
  ]);
  ok(res, paginated(rows.map((r) => ({ ...r, videoTitle: r.videoTitle ?? '(已删除)', startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })), Number(countRows[0]?.total ?? 0), page, pageSize));
}));

adminRouter.get('/transcode/stream', asyncHandler(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  let closed = false;
  req.on('close', () => { closed = true; });
  const push = async () => {
    if (closed) return;
    const rows = await db.select({ id: t.transcodeJobs.id, videoId: t.transcodeJobs.videoId, videoTitle: t.videos.title, status: t.transcodeJobs.status, progress: t.transcodeJobs.progress, stage: t.transcodeJobs.stage, currentRendition: t.transcodeJobs.currentRendition, completedRenditions: t.transcodeJobs.completedRenditions, errorMessage: t.transcodeJobs.errorMessage }).from(t.transcodeJobs).leftJoin(t.videos, eq(t.videos.id, t.transcodeJobs.videoId)).where(sql`${t.transcodeJobs.status} not in ('completed','canceled')`).orderBy(desc(t.transcodeJobs.createdAt)).limit(30);
    if (!closed) res.write(`data: ${JSON.stringify(rows)}\n\n`);
  };
  await push();
  const timer = setInterval(() => { void push().catch(() => undefined); }, 2000);
  req.on('close', () => { clearInterval(timer); res.end(); });
}));

adminRouter.post('/transcode/jobs/:id/cancel', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [job] = await db.select().from(t.transcodeJobs).where(eq(t.transcodeJobs.id, id)).limit(1);
  if (!job) throw AppError.notFound('任务不存在');
  const queueJob = await getTranscodeQueue().getJob(job.queueJobId ?? job.id);
  await queueJob?.remove().catch(() => undefined);
  await db.update(t.transcodeJobs).set({ status: 'canceled', finishedAt: new Date() }).where(eq(t.transcodeJobs.id, id));
  await audit(req, 'transcode.cancel', { type: 'job', id });
  ok(res, null, '任务已取消');
}));

adminRouter.get('/users', validate({ query: userAdminQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<{ page: number; pageSize: number; q?: string; role?: 'user' | 'vip' | 'admin'; status?: 'active' | 'banned'; vipOnly?: boolean; }>(req);
  const filters = [];
  if (q.q) filters.push(sql`(${t.users.username} ILIKE ${'%' + q.q + '%'} OR ${t.users.email} ILIKE ${'%' + q.q + '%'} OR ${t.users.displayName} ILIKE ${'%' + q.q + '%'})`);
  if (q.role) filters.push(eq(t.users.role, q.role));
  if (q.status) filters.push(eq(t.users.status, q.status));
  if (q.vipOnly) filters.push(sql`${t.users.vipExpiresAt} > now()`);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.users.id, email: t.users.email, username: t.users.username, displayName: t.users.displayName, avatarUrl: t.users.avatarUrl, role: t.users.role, status: t.users.status, vipExpiresAt: t.users.vipExpiresAt, videoCount: t.users.videoCount, followerCount: t.users.followerCount, lastLoginAt: t.users.lastLoginAt, createdAt: t.users.createdAt }).from(t.users).where(where).orderBy(desc(t.users.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.users).where(where),
  ]);
  ok(res, paginated(rows.map((r) => ({ ...r, isVip: r.role === 'admin' || (r.vipExpiresAt !== null && r.vipExpiresAt.getTime() > Date.now()), vipExpiresAt: r.vipExpiresAt?.toISOString() ?? null, lastLoginAt: r.lastLoginAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })), Number(countRows[0]?.total ?? 0), q.page, q.pageSize));
}));

adminRouter.patch('/users/:id', validate({ params: idParam, body: updateUserAdminSchema }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Record<string, unknown>>(req);
  if (id === req.auth!.id && input.role && input.role !== 'admin') throw AppError.badRequest('不能取消自己的管理员权限');
  const [updated] = await db.update(t.users).set({ ...input, updatedAt: new Date() }).where(eq(t.users.id, id)).returning({ id: t.users.id, role: t.users.role, status: t.users.status });
  if (!updated) throw AppError.notFound('用户不存在');
  if (input.status === 'banned') await db.update(t.refreshTokens).set({ revokedAt: new Date() }).where(eq(t.refreshTokens.userId, id));
  await audit(req, 'user.update', { type: 'user', id }, input);
  ok(res, updated, '用户已更新');
}));

adminRouter.post('/users/grant-vip', validate({ body: grantVipSchema }), asyncHandler(async (req, res) => {
  const input = body<{ userId: string; days: number; note?: string }>(req);
  const result = await grantVip({ ...input, operatorId: req.auth!.id });
  await audit(req, 'user.grant_vip', { type: 'user', id: input.userId }, { days: input.days });
  ok(res, result, `已赠送 ${input.days} 天会员`);
}));

adminRouter.post('/users/:id/revoke-vip', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await revokeVip(id);
  await audit(req, 'user.revoke_vip', { type: 'user', id });
  ok(res, null, '会员权益已收回');
}));

adminRouter.get('/comments', validate({ query: commentListQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<{ page: number; pageSize: number; status?: string; q?: string; videoId?: string }>(req);
  const filters = [];
  if (q.status) filters.push(eq(t.comments.status, q.status as 'visible'));
  if (q.videoId) filters.push(eq(t.comments.videoId, q.videoId));
  if (q.q) filters.push(sql`${t.comments.content} ILIKE ${'%' + q.q + '%'}`);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.comments.id, content: t.comments.content, status: t.comments.status, likeCount: t.comments.likeCount, reportCount: t.comments.reportCount, createdAt: t.comments.createdAt, videoId: t.comments.videoId, videoTitle: t.videos.title, authorName: t.users.displayName, authorUsername: t.users.username }).from(t.comments).leftJoin(t.videos, eq(t.videos.id, t.comments.videoId)).leftJoin(t.users, eq(t.users.id, t.comments.userId)).where(where).orderBy(desc(t.comments.reportCount), desc(t.comments.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.comments).where(where),
  ]);
  ok(res, paginated(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), Number(countRows[0]?.total ?? 0), q.page, q.pageSize));
}));

adminRouter.post('/comments/:id/moderate', validate({ params: idParam, body: z.object({ status: z.enum(['visible', 'hidden', 'deleted']) }) }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { status } = body<{ status: 'visible' | 'hidden' | 'deleted' }>(req);
  const [comment] = await db.select().from(t.comments).where(eq(t.comments.id, id)).limit(1);
  if (!comment) throw AppError.notFound('评论不存在');
  await db.transaction(async (tx) => {
    await tx.update(t.comments).set({ status, updatedAt: new Date() }).where(eq(t.comments.id, id));
    const wasVisible = comment.status === 'visible';
    const nowVisible = status === 'visible';
    if (wasVisible !== nowVisible) {
      await tx.update(t.videos).set({ commentCount: nowVisible ? sql`${t.videos.commentCount} + 1` : sql`greatest(0, ${t.videos.commentCount} - 1)` }).where(eq(t.videos.id, comment.videoId));
    }
  });
  await audit(req, 'comment.moderate', { type: 'comment', id }, { status });
  ok(res, null, '已处理');
}));

adminRouter.get('/categories', asyncHandler(async (_req, res) => { ok(res, await db.select().from(t.categories).orderBy(t.categories.sortOrder, t.categories.name)); }));
adminRouter.post('/categories', validate({ body: categorySchema }), asyncHandler(async (req, res) => {
  const input = body<Record<string, unknown>>(req);
  const [row] = await db.insert(t.categories).values(input as never).returning();
  await invalidate('catalog:categories');
  await audit(req, 'category.create', { type: 'category', id: row!.id });
  ok(res, row, '分类已创建');
}));
adminRouter.patch('/categories/:id', validate({ params: idParam, body: categorySchema.partial() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [row] = await db.update(t.categories).set({ ...body<Record<string, unknown>>(req), updatedAt: new Date() } as never).where(eq(t.categories.id, id)).returning();
  if (!row) throw AppError.notFound('分类不存在');
  await invalidate('catalog:categories');
  await audit(req, 'category.update', { type: 'category', id });
  ok(res, row, '分类已更新');
}));
adminRouter.delete('/categories/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [used] = await db.select({ c: sql<number>`count(*)::int` }).from(t.videos).where(eq(t.videos.categoryId, id));
  if (Number(used?.c ?? 0) > 0) throw AppError.badRequest('该分类下还有视频，请先移动或删除');
  await db.delete(t.categories).where(eq(t.categories.id, id));
  await invalidate('catalog:categories');
  await audit(req, 'category.delete', { type: 'category', id });
  ok(res, null, '分类已删除');
}));

adminRouter.get('/tags', validate({ query: paginationSchema }), asyncHandler(async (req, res) => {
  const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
  const [rows, countRows] = await Promise.all([db.select().from(t.tags).orderBy(desc(t.tags.videoCount)).limit(pageSize).offset((page - 1) * pageSize), db.select({ total: sql<number>`count(*)::int` }).from(t.tags)]);
  ok(res, paginated(rows, Number(countRows[0]?.total ?? 0), page, pageSize));
}));
adminRouter.delete('/tags/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await db.delete(t.tags).where(eq(t.tags.id, id));
  await invalidate('catalog:tags:*');
  await audit(req, 'tag.delete', { type: 'tag', id });
  ok(res, null, '标签已删除');
}));

adminRouter.get('/banners', asyncHandler(async (_req, res) => { ok(res, await db.select().from(t.banners).orderBy(t.banners.sortOrder)); }));
adminRouter.post('/banners', validate({ body: bannerSchema }), asyncHandler(async (req, res) => {
  const input = body<Record<string, unknown>>(req);
  const [row] = await db.insert(t.banners).values({ ...input, startsAt: input.startsAt ? new Date(input.startsAt as string) : null, endsAt: input.endsAt ? new Date(input.endsAt as string) : null } as never).returning();
  await audit(req, 'banner.create', { type: 'banner', id: row!.id });
  ok(res, row, '轮播图已创建');
}));
adminRouter.patch('/banners/:id', validate({ params: idParam, body: bannerSchema.partial() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Record<string, unknown>>(req);
  const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt ? new Date(input.startsAt as string) : null;
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt ? new Date(input.endsAt as string) : null;
  const [row] = await db.update(t.banners).set(patch as never).where(eq(t.banners.id, id)).returning();
  if (!row) throw AppError.notFound('轮播图不存在');
  await audit(req, 'banner.update', { type: 'banner', id });
  ok(res, row, '轮播图已更新');
}));
adminRouter.delete('/banners/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await db.delete(t.banners).where(eq(t.banners.id, id));
  await audit(req, 'banner.delete', { type: 'banner', id });
  ok(res, null, '轮播图已删除');
}));

adminRouter.get('/plans', asyncHandler(async (_req, res) => { ok(res, await listPlans(false)); }));
adminRouter.post('/plans', validate({ body: planSchema }), asyncHandler(async (req, res) => {
  const [row] = await db.insert(t.plans).values(body<Record<string, unknown>>(req) as never).returning();
  await audit(req, 'plan.create', { type: 'plan', id: row!.id });
  ok(res, toPlan(row!), '套餐已创建');
}));
adminRouter.patch('/plans/:id', validate({ params: idParam, body: planSchema.partial() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [row] = await db.update(t.plans).set({ ...body<Record<string, unknown>>(req), updatedAt: new Date() } as never).where(eq(t.plans.id, id)).returning();
  if (!row) throw AppError.notFound('套餐不存在');
  await audit(req, 'plan.update', { type: 'plan', id });
  ok(res, toPlan(row), '套餐已更新');
}));
adminRouter.delete('/plans/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [used] = await db.select({ c: sql<number>`count(*)::int` }).from(t.redeemCodes).where(eq(t.redeemCodes.planId, id));
  if (Number(used?.c ?? 0) > 0) throw AppError.badRequest('该套餐已生成过卡密，只能停用不能删除');
  await db.delete(t.plans).where(eq(t.plans.id, id));
  await audit(req, 'plan.delete', { type: 'plan', id });
  ok(res, null, '套餐已删除');
}));

async function queryCodes(q: { page: number; pageSize: number; status?: string; planId?: string; batchId?: string; q?: string; }) {
  const filters = [];
  if (q.status) filters.push(eq(t.redeemCodes.status, q.status as 'unused'));
  if (q.planId) filters.push(eq(t.redeemCodes.planId, q.planId));
  if (q.batchId) filters.push(eq(t.redeemCodes.batchId, q.batchId));
  if (q.q) filters.push(sql`${t.redeemCodes.code} ILIKE ${'%' + q.q.toUpperCase() + '%'}`);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.redeemCodes.id, code: t.redeemCodes.code, planId: t.redeemCodes.planId, batchId: t.redeemCodes.batchId, status: t.redeemCodes.status, usedByUserId: t.redeemCodes.usedByUserId, usedAt: t.redeemCodes.usedAt, expiresAt: t.redeemCodes.expiresAt, note: t.redeemCodes.note, createdBy: t.redeemCodes.createdBy, createdAt: t.redeemCodes.createdAt, updatedAt: t.redeemCodes.updatedAt, planName: t.plans.name, usedByUsername: t.users.username }).from(t.redeemCodes).leftJoin(t.plans, eq(t.plans.id, t.redeemCodes.planId)).leftJoin(t.users, eq(t.users.id, t.redeemCodes.usedByUserId)).where(where).orderBy(desc(t.redeemCodes.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.redeemCodes).where(where),
  ]);
  return { rows, total: Number(countRows[0]?.total ?? 0) };
}

adminRouter.get('/redeem-codes', validate({ query: redeemCodeQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<Parameters<typeof queryCodes>[0]>(req);
  const { rows, total } = await queryCodes(q);
  ok(res, paginated(rows.map((r) => toRedeemCode(r as never)), total, q.page, q.pageSize));
}));
adminRouter.post('/redeem-codes/generate', validate({ body: generateCodesSchema }), asyncHandler(async (req, res) => {
  const input = body<{ planId: string; count: number; prefix?: string; expiresAt?: string | null; note?: string; }>(req);
  const result = await generateCodes({ planId: input.planId, count: input.count, prefix: input.prefix, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, note: input.note, createdBy: req.auth!.id });
  await audit(req, 'redeem_code.generate', { type: 'batch', id: result.batchId }, { count: result.codes.length });
  ok(res, result, `已生成 ${result.codes.length} 个兑换码`);
}));
adminRouter.get('/redeem-codes/export', validate({ query: redeemCodeQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<Parameters<typeof queryCodes>[0]>(req);
  const { rows } = await queryCodes({ ...q, page: 1, pageSize: 5000 });
  const csv = codesToCsv(rows.map((r) => toRedeemCode(r as never)));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="redeem-codes-${Date.now()}.csv"`);
  res.send(csv);
}));
adminRouter.post('/redeem-codes/:id/disable', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const [row] = await db.update(t.redeemCodes).set({ status: 'disabled', updatedAt: new Date() }).where(and(eq(t.redeemCodes.id, id), eq(t.redeemCodes.status, 'unused'))).returning();
  if (!row) throw AppError.badRequest('只能停用未使用的兑换码');
  await audit(req, 'redeem_code.disable', { type: 'redeem_code', id });
  ok(res, null, '兑换码已停用');
}));

adminRouter.get('/orders', validate({ query: orderQuerySchema }), asyncHandler(async (req, res) => {
  const q = query<{ page: number; pageSize: number; status?: string; q?: string }>(req);
  const filters = [];
  if (q.status) filters.push(eq(t.orders.status, q.status as 'paid'));
  if (q.q) filters.push(sql`${t.orders.orderNo} ILIKE ${'%' + q.q + '%'}`);
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.orders.id, orderNo: t.orders.orderNo, userId: t.orders.userId, planId: t.orders.planId, amountCents: t.orders.amountCents, source: t.orders.source, status: t.orders.status, redeemCodeId: t.orders.redeemCodeId, note: t.orders.note, channelPayload: t.orders.channelPayload, createdAt: t.orders.createdAt, updatedAt: t.orders.updatedAt, username: t.users.username, planName: t.plans.name }).from(t.orders).leftJoin(t.users, eq(t.users.id, t.orders.userId)).leftJoin(t.plans, eq(t.plans.id, t.orders.planId)).where(where).orderBy(desc(t.orders.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.orders).where(where),
  ]);
  ok(res, paginated(rows.map((r) => toOrder(r as never)), Number(countRows[0]?.total ?? 0), q.page, q.pageSize));
}));

adminRouter.get('/storage', asyncHandler(async (_req, res) => { ok(res, await listStorageProfiles()); }));
adminRouter.post('/storage', validate({ body: storageProfileSchema }), asyncHandler(async (req, res) => {
  const input = body<{ name: string; driver: 'local' | 's3'; isActive: boolean; config: Record<string, unknown> }>(req);
  const profile = await createStorageProfile(input);
  await audit(req, 'storage.create', { type: 'storage', id: profile.id });
  ok(res, profile, '存储配置已创建');
}));
adminRouter.patch('/storage/:id', validate({ params: idParam, body: storageProfileSchema.partial() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const profile = await updateStorageProfileHandler(id, body<Record<string, unknown>>(req));
  await audit(req, 'storage.update', { type: 'storage', id });
  ok(res, profile, '存储配置已保存');
}));
async function updateStorageProfileHandler(id: string, input: Record<string, unknown>) {
  const { updateStorageProfile } = await import('../storage/service.js');
  return updateStorageProfile(id, input as never);
}
adminRouter.post('/storage/:id/activate', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await activateStorageProfile(id);
  await audit(req, 'storage.activate', { type: 'storage', id });
  ok(res, null, '已切换存储驱动');
}));
adminRouter.post('/storage/:id/test', validate({ params: idParam, body: storageProfileSchema.partial().optional() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const override = body<{ driver?: 'local' | 's3'; config?: Record<string, unknown> } | undefined>(req);
  const result = await testStorageProfile(id, override?.driver && override.config ? { driver: override.driver, config: override.config } : undefined);
  ok(res, result, result.message);
}));
adminRouter.delete('/storage/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await deleteStorageProfile(id);
  await audit(req, 'storage.delete', { type: 'storage', id });
  ok(res, null, '存储配置已删除');
}));

adminRouter.get('/settings/site', asyncHandler(async (_req, res) => { ok(res, await getSiteSettings()); }));
adminRouter.put('/settings/site', validate({ body: siteSettingsSchema }), asyncHandler(async (req, res) => {
  const saved = await saveSiteSettings(body(req));
  await audit(req, 'settings.site.update');
  ok(res, saved, '站点设置已保存');
}));
adminRouter.get('/settings/algo', asyncHandler(async (_req, res) => { ok(res, await getAlgoWeights()); }));
adminRouter.put('/settings/algo', validate({ body: algoWeightsSchema }), asyncHandler(async (req, res) => {
  const saved = await saveAlgoWeights(body(req));
  await audit(req, 'settings.algo.update', undefined, saved as unknown as Record<string, unknown>);
  ok(res, saved, '推荐权重已保存');
}));

function maskAiProfile(row: typeof t.aiProfiles.$inferSelect) {
  return { ...row, apiKey: row.apiKey ? '••••••••' : '', createdAt: row.createdAt.toISOString() };
}
adminRouter.get('/ai/profiles', asyncHandler(async (_req, res) => {
  const rows = await db.select().from(t.aiProfiles).orderBy(desc(t.aiProfiles.createdAt));
  ok(res, rows.map(maskAiProfile));
}));
adminRouter.post('/ai/profiles', validate({ body: aiProfileSchema }), asyncHandler(async (req, res) => {
  const [row] = await db.insert(t.aiProfiles).values(body<Record<string, unknown>>(req) as never).returning();
  await audit(req, 'ai.profile.create', { type: 'ai_profile', id: row!.id });
  ok(res, maskAiProfile(row!), 'AI 配置已创建');
}));
adminRouter.patch('/ai/profiles/:id', validate({ params: idParam, body: aiProfileSchema.partial() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Record<string, unknown>>(req);
  if (input.apiKey === '••••••••' || input.apiKey === '') delete input.apiKey;
  const [row] = await db.update(t.aiProfiles).set({ ...input, updatedAt: new Date() } as never).where(eq(t.aiProfiles.id, id)).returning();
  if (!row) throw AppError.notFound('AI 配置不存在');
  await audit(req, 'ai.profile.update', { type: 'ai_profile', id });
  ok(res, maskAiProfile(row), 'AI 配置已保存');
}));
adminRouter.delete('/ai/profiles/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await db.delete(t.aiProfiles).where(eq(t.aiProfiles.id, id));
  await audit(req, 'ai.profile.delete', { type: 'ai_profile', id });
  ok(res, null, 'AI 配置已删除');
}));
adminRouter.post('/ai/profiles/:id/run', validate({ params: idParam, body: z.object({ videoIds: z.array(z.string()).max(500).optional() }).optional() }), asyncHandler(async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<{ videoIds?: string[] } | undefined>(req);
  const [profile] = await db.select().from(t.aiProfiles).where(eq(t.aiProfiles.id, id)).limit(1);
  if (!profile) throw AppError.notFound('AI 配置不存在');
  if (!profile.apiKey) throw AppError.badRequest('请先填写 API Key');
  const [run] = await db.insert(t.aiScoringRuns).values({ profileId: id, status: 'running' }).returning();
  await getAiQueue().add('score', { profileId: id, runId: run!.id, videoIds: input?.videoIds });
  await audit(req, 'ai.run', { type: 'ai_profile', id });
  ok(res, { runId: run!.id }, 'AI 打分任务已启动');
}));
adminRouter.get('/ai/runs', asyncHandler(async (_req, res) => {
  const rows = await db.select({ id: t.aiScoringRuns.id, profileId: t.aiScoringRuns.profileId, profileName: t.aiProfiles.name, status: t.aiScoringRuns.status, totalVideos: t.aiScoringRuns.totalVideos, scoredVideos: t.aiScoringRuns.scoredVideos, errorMessage: t.aiScoringRuns.errorMessage, startedAt: t.aiScoringRuns.startedAt, finishedAt: t.aiScoringRuns.finishedAt }).from(t.aiScoringRuns).leftJoin(t.aiProfiles, eq(t.aiProfiles.id, t.aiScoringRuns.profileId)).orderBy(desc(t.aiScoringRuns.startedAt)).limit(20);
  ok(res, rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })));
}));
adminRouter.get('/ai/scores', validate({ query: paginationSchema }), asyncHandler(async (req, res) => {
  const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
  const [rows, countRows] = await Promise.all([
    db.select({ id: t.videos.id, title: t.videos.title, posterUrl: t.videos.posterUrl, aiScore: t.videos.aiScore, aiReason: t.videos.aiReason, aiScoredAt: t.videos.aiScoredAt, viewCount: t.videos.viewCount }).from(t.videos).where(sql`${t.videos.aiScore} is not null`).orderBy(desc(t.videos.aiScore)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.videos).where(sql`${t.videos.aiScore} is not null`),
  ]);
  ok(res, paginated(rows.map((r) => ({ ...r, aiScoredAt: r.aiScoredAt?.toISOString() ?? null })), Number(countRows[0]?.total ?? 0), page, pageSize));
}));

adminRouter.get('/audit-logs', validate({ query: paginationSchema }), asyncHandler(async (req, res) => {
  const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
  const { items, total } = await listAuditLogs(page, pageSize);
  ok(res, paginated(items, total, page, pageSize));
}));
