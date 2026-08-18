import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { paginationSchema, progressSchema, type FavoriteItem, type WatchHistoryItem } from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { requireAuth } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/request-context.js';
import { body, query, validate } from '../../middleware/validate.js';
import { listVideos, requireVideo, getSummariesByIds } from '../videos/service.js';
import { recordBehavior } from '../recommend/service.js';

export const interactionsRouter: Router = Router();

/**
 * 这个路由挂在 `/api` 根上，和 catalog 等公开路由共享前缀，
 * 所以不能无条件 `use(requireAuth)`——那样未匹配的请求会穿透过来被判 401。
 * 只对本路由自己负责的路径前缀加守卫。
 */
interactionsRouter.use(
  [
    '/videos/:id/like',
    '/videos/:id/favorite',
    '/users/:id/follow',
    '/favorites',
    '/following',
    '/progress',
    '/history',
    '/continue-watching',
    '/my-videos',
  ],
  requireAuth,
);

// --------------------------------------------------------------------------
// 点赞
// --------------------------------------------------------------------------

interactionsRouter.post(
  '/videos/:id/like',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    const userId = req.auth!.id;

    const liked = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ x: sql`1` })
        .from(t.videoLikes)
        .where(and(eq(t.videoLikes.videoId, video.id), eq(t.videoLikes.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .delete(t.videoLikes)
          .where(and(eq(t.videoLikes.videoId, video.id), eq(t.videoLikes.userId, userId)));
        await tx
          .update(t.videos)
          .set({ likeCount: sql`greatest(0, ${t.videos.likeCount} - 1)` })
          .where(eq(t.videos.id, video.id));
        return false;
      }

      await tx.insert(t.videoLikes).values({ videoId: video.id, userId });
      await tx
        .update(t.videos)
        .set({ likeCount: sql`${t.videos.likeCount} + 1` })
        .where(eq(t.videos.id, video.id));
      return true;
    });

    if (liked) void recordBehavior(userId, video.id, 'like');

    const [row] = await db
      .select({ likeCount: t.videos.likeCount })
      .from(t.videos)
      .where(eq(t.videos.id, video.id))
      .limit(1);

    ok(res, { liked, likeCount: row?.likeCount ?? 0 });
  }),
);

// --------------------------------------------------------------------------
// 收藏
// --------------------------------------------------------------------------

interactionsRouter.post(
  '/videos/:id/favorite',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    const userId = req.auth!.id;

    const favorited = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ x: sql`1` })
        .from(t.favorites)
        .where(and(eq(t.favorites.videoId, video.id), eq(t.favorites.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        await tx.delete(t.favorites).where(and(eq(t.favorites.videoId, video.id), eq(t.favorites.userId, userId)));
        await tx
          .update(t.videos)
          .set({ favoriteCount: sql`greatest(0, ${t.videos.favoriteCount} - 1)` })
          .where(eq(t.videos.id, video.id));
        return false;
      }

      await tx.insert(t.favorites).values({ videoId: video.id, userId });
      await tx
        .update(t.videos)
        .set({ favoriteCount: sql`${t.videos.favoriteCount} + 1` })
        .where(eq(t.videos.id, video.id));
      return true;
    });

    if (favorited) void recordBehavior(userId, video.id, 'favorite');

    ok(res, { favorited });
  }),
);

interactionsRouter.get(
  '/favorites',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
    const userId = req.auth!.id;

    const [rows, countRows] = await Promise.all([
      db
        .select({ videoId: t.favorites.videoId, createdAt: t.favorites.createdAt })
        .from(t.favorites)
        .where(eq(t.favorites.userId, userId))
        .orderBy(desc(t.favorites.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.favorites)
        .where(eq(t.favorites.userId, userId)),
    ]);

    const summaries = await getSummariesByIds(rows.map((r) => r.videoId));
    const byId = new Map(summaries.map((s) => [s.id, s]));

    const items: FavoriteItem[] = rows
      .map((r) => {
        const video = byId.get(r.videoId);
        return video ? { id: r.videoId, video, createdAt: r.createdAt.toISOString() } : null;
      })
      .filter((v): v is FavoriteItem => v !== null);

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), page, pageSize));
  }),
);

// --------------------------------------------------------------------------
// 关注
// --------------------------------------------------------------------------

interactionsRouter.post(
  '/users/:id/follow',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const followeeId = req.params.id!;
    const followerId = req.auth!.id;
    if (followeeId === followerId) throw AppError.badRequest('不能关注自己');

    const [target] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, followeeId)).limit(1);
    if (!target) throw AppError.notFound('用户不存在');

    const following = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ x: sql`1` })
        .from(t.follows)
        .where(and(eq(t.follows.followerId, followerId), eq(t.follows.followeeId, followeeId)))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .delete(t.follows)
          .where(and(eq(t.follows.followerId, followerId), eq(t.follows.followeeId, followeeId)));
        await tx
          .update(t.users)
          .set({ followerCount: sql`greatest(0, ${t.users.followerCount} - 1)` })
          .where(eq(t.users.id, followeeId));
        await tx
          .update(t.users)
          .set({ followingCount: sql`greatest(0, ${t.users.followingCount} - 1)` })
          .where(eq(t.users.id, followerId));
        return false;
      }

      await tx.insert(t.follows).values({ followerId, followeeId });
      await tx
        .update(t.users)
        .set({ followerCount: sql`${t.users.followerCount} + 1` })
        .where(eq(t.users.id, followeeId));
      await tx
        .update(t.users)
        .set({ followingCount: sql`${t.users.followingCount} + 1` })
        .where(eq(t.users.id, followerId));
      return true;
    });

    ok(res, { following });
  }),
);

interactionsRouter.get(
  '/following',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: t.users.id,
          username: t.users.username,
          displayName: t.users.displayName,
          avatarUrl: t.users.avatarUrl,
          bio: t.users.bio,
          followerCount: t.users.followerCount,
          followingCount: t.users.followingCount,
          videoCount: t.users.videoCount,
          createdAt: t.users.createdAt,
        })
        .from(t.follows)
        .innerJoin(t.users, eq(t.users.id, t.follows.followeeId))
        .where(eq(t.follows.followerId, req.auth!.id))
        .orderBy(desc(t.follows.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.follows)
        .where(eq(t.follows.followerId, req.auth!.id)),
    ]);

    ok(
      res,
      paginated(
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      ),
    );
  }),
);

/** 关注动态：已关注作者的最新投稿。 */
interactionsRouter.get(
  '/following/feed',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);

    const followees = await db
      .select({ id: t.follows.followeeId })
      .from(t.follows)
      .where(eq(t.follows.followerId, req.auth!.id));

    if (followees.length === 0) {
      ok(res, paginated([], 0, page, pageSize));
      return;
    }

    const rows = await sqlRows<{ id: string }>(sql`
      SELECT id FROM videos
      WHERE author_id = any(${uuidArray(followees.map((f) => f.id))})
        AND status IN ('ready','partially_ready') AND visibility = 'public'
      ORDER BY coalesce(published_at, created_at) DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    const [countRow] = await sqlRows<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM videos
      WHERE author_id = any(${uuidArray(followees.map((f) => f.id))})
        AND status IN ('ready','partially_ready') AND visibility = 'public'
    `);

    const items = await getSummariesByIds(rows.map((r) => r.id));
    ok(res, paginated(items, Number(countRow?.total ?? 0), page, pageSize));
  }),
);

// --------------------------------------------------------------------------
// 观看历史与进度
// --------------------------------------------------------------------------

/**
 * 播放进度上报。播放器每 15 秒调一次，
 * deltaSeconds 是本次心跳里真实播放的秒数（拖动跳过的不计），用来累计总观看时长。
 */
interactionsRouter.post(
  '/progress',
  validate({ body: progressSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      videoId: string;
      positionSeconds: number;
      durationSeconds?: number;
      deltaSeconds?: number;
    }>(req);

    const userId = req.auth!.id;
    const duration = input.durationSeconds ?? 0;
    const delta = Math.min(input.deltaSeconds ?? 0, 600);
    // 看到 92% 就算完播，片尾曲不该拖累完播率。
    const completed = duration > 0 && input.positionSeconds >= duration * 0.92;

    await db
      .insert(t.watchHistory)
      .values({
        userId,
        videoId: input.videoId,
        positionSeconds: input.positionSeconds,
        durationSeconds: duration,
        watchedSeconds: delta,
        completed,
        watchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [t.watchHistory.userId, t.watchHistory.videoId],
        set: {
          positionSeconds: input.positionSeconds,
          durationSeconds: sql`greatest(${t.watchHistory.durationSeconds}, ${duration})`,
          watchedSeconds: sql`${t.watchHistory.watchedSeconds} + ${delta}`,
          completed: sql`${t.watchHistory.completed} or ${completed}`,
          watchedAt: new Date(),
        },
      });

    if (delta > 0) {
      await db
        .update(t.videos)
        .set({ totalWatchSeconds: sql`${t.videos.totalWatchSeconds} + ${Math.round(delta)}` })
        .where(eq(t.videos.id, input.videoId));
    }

    if (completed) void recordBehavior(userId, input.videoId, 'complete');
    else if (delta > 30) void recordBehavior(userId, input.videoId, 'view');

    ok(res, { saved: true, completed });
  }),
);

interactionsRouter.get(
  '/history',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
    const userId = req.auth!.id;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: t.watchHistory.id,
          videoId: t.watchHistory.videoId,
          positionSeconds: t.watchHistory.positionSeconds,
          durationSeconds: t.watchHistory.durationSeconds,
          watchedAt: t.watchHistory.watchedAt,
        })
        .from(t.watchHistory)
        .where(eq(t.watchHistory.userId, userId))
        .orderBy(desc(t.watchHistory.watchedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(t.watchHistory)
        .where(eq(t.watchHistory.userId, userId)),
    ]);

    const summaries = await getSummariesByIds(rows.map((r) => r.videoId));
    const byId = new Map(summaries.map((s) => [s.id, s]));

    const items: WatchHistoryItem[] = rows
      .map((r) => {
        const video = byId.get(r.videoId);
        if (!video) return null;
        const duration = r.durationSeconds || video.durationSeconds || 0;
        return {
          id: r.id,
          video,
          positionSeconds: Math.floor(r.positionSeconds),
          durationSeconds: Math.floor(duration),
          percent: duration > 0 ? Math.min(100, Math.round((r.positionSeconds / duration) * 100)) : 0,
          watchedAt: r.watchedAt.toISOString(),
        };
      })
      .filter((v): v is WatchHistoryItem => v !== null);

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), page, pageSize));
  }),
);

interactionsRouter.delete(
  '/history/:videoId',
  asyncHandler(async (req, res) => {
    await db
      .delete(t.watchHistory)
      .where(and(eq(t.watchHistory.userId, req.auth!.id), eq(t.watchHistory.videoId, req.params.videoId!)));
    ok(res, null, '已从历史记录中移除');
  }),
);

interactionsRouter.delete(
  '/history',
  asyncHandler(async (req, res) => {
    await db.delete(t.watchHistory).where(eq(t.watchHistory.userId, req.auth!.id));
    ok(res, null, '历史记录已清空');
  }),
);

/** 继续观看：有进度但没看完的，首页做「继续观看」卡片。 */
interactionsRouter.get(
  '/continue-watching',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) }) }),
  asyncHandler(async (req, res) => {
    const { limit } = query<{ limit: number }>(req);

    const rows = await db
      .select({
        id: t.watchHistory.id,
        videoId: t.watchHistory.videoId,
        positionSeconds: t.watchHistory.positionSeconds,
        durationSeconds: t.watchHistory.durationSeconds,
        watchedAt: t.watchHistory.watchedAt,
      })
      .from(t.watchHistory)
      .where(
        and(
          eq(t.watchHistory.userId, req.auth!.id),
          eq(t.watchHistory.completed, false),
          sql`${t.watchHistory.positionSeconds} > 20`,
        ),
      )
      .orderBy(desc(t.watchHistory.watchedAt))
      .limit(limit);

    const summaries = await getSummariesByIds(rows.map((r) => r.videoId));
    const byId = new Map(summaries.map((s) => [s.id, s]));

    ok(
      res,
      rows
        .map((r) => {
          const video = byId.get(r.videoId);
          if (!video) return null;
          const duration = r.durationSeconds || video.durationSeconds || 0;
          return {
            id: r.id,
            video,
            positionSeconds: Math.floor(r.positionSeconds),
            durationSeconds: Math.floor(duration),
            percent: duration > 0 ? Math.min(100, Math.round((r.positionSeconds / duration) * 100)) : 0,
            watchedAt: r.watchedAt.toISOString(),
          };
        })
        .filter(Boolean),
    );
  }),
);

/** 我上传的视频 */
interactionsRouter.get(
  '/my-videos',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
    const result = await listVideos({
      page,
      pageSize,
      authorId: req.auth!.id,
      adminView: true,
      sort: 'latest',
    });
    ok(res, paginated(result.items, result.total, page, pageSize));
  }),
);
