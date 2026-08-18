import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { commentListQuerySchema, createCommentSchema, type Comment } from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { writeLimiter, clientIp } from '../../middleware/request-context.js';
import { body, query, validate } from '../../middleware/validate.js';
import { getSiteSettings } from '../settings/service.js';
import { requireVideo } from '../videos/service.js';
import { recordBehavior } from '../recommend/service.js';

export const commentsRouter: Router = Router();

type CommentJoinRow = {
  id: string;
  videoId: string;
  parentId: string | null;
  rootId: string | null;
  content: string;
  status: Comment['status'];
  likeCount: number;
  replyCount: number;
  pinned: boolean;
  createdAt: Date;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  replyToUserId: string | null;
  replyToUsername: string | null;
  replyToDisplayName: string | null;
};

const authorAlias = t.users;

function selectComment() {
  return db
    .select({
      id: t.comments.id,
      videoId: t.comments.videoId,
      parentId: t.comments.parentId,
      rootId: t.comments.rootId,
      content: t.comments.content,
      status: t.comments.status,
      likeCount: t.comments.likeCount,
      replyCount: t.comments.replyCount,
      pinned: t.comments.pinned,
      createdAt: t.comments.createdAt,
      authorId: authorAlias.id,
      authorUsername: authorAlias.username,
      authorDisplayName: authorAlias.displayName,
      authorAvatarUrl: authorAlias.avatarUrl,
      replyToUserId: t.comments.replyToUserId,
      replyToUsername: sql<string | null>`reply_to.username`,
      replyToDisplayName: sql<string | null>`reply_to.display_name`,
    })
    .from(t.comments)
    .innerJoin(authorAlias, eq(authorAlias.id, t.comments.userId))
    .leftJoin(sql`users AS reply_to`, sql`reply_to.id = ${t.comments.replyToUserId}`);
}

function toComment(row: CommentJoinRow, likedIds: Set<string>, replies: Comment[] = []): Comment {
  return {
    id: row.id,
    videoId: row.videoId,
    parentId: row.parentId,
    rootId: row.rootId,
    content: row.content,
    status: row.status,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    author: {
      id: row.authorId,
      username: row.authorUsername,
      displayName: row.authorDisplayName,
      avatarUrl: row.authorAvatarUrl,
    },
    replyToUser: row.replyToUserId && row.replyToUsername
      ? { id: row.replyToUserId, username: row.replyToUsername, displayName: row.replyToDisplayName ?? '' }
      : null,
    liked: likedIds.has(row.id),
    replies,
  };
}

async function loadLikedIds(commentIds: string[], userId: string | null): Promise<Set<string>> {
  if (!userId || commentIds.length === 0) return new Set();
  const rows = await db
    .select({ commentId: t.commentLikes.commentId })
    .from(t.commentLikes)
    .where(and(eq(t.commentLikes.userId, userId), inArray(t.commentLikes.commentId, commentIds)));
  return new Set(rows.map((r) => r.commentId));
}

/**
 * 楼中楼列表：先分页取顶层评论，再一次性把这些楼的前 3 条回复捞出来。
 * 两次查询解决 N+1，深层回复走「查看更多」单独拉取。
 */
commentsRouter.get(
  '/',
  optionalAuth,
  validate({ query: commentListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      videoId?: string;
      sort: 'newest' | 'oldest' | 'hottest';
    }>(req);

    if (!q.videoId) throw AppError.badRequest('缺少 videoId');

    const orderBy =
      q.sort === 'newest'
        ? [desc(t.comments.pinned), desc(t.comments.createdAt)]
        : q.sort === 'oldest'
          ? [desc(t.comments.pinned), asc(t.comments.createdAt)]
          : [desc(t.comments.pinned), desc(t.comments.likeCount), desc(t.comments.createdAt)];

    const where = and(
      eq(t.comments.videoId, q.videoId),
      sql`${t.comments.parentId} is null`,
      eq(t.comments.status, 'visible'),
    );

    const [roots, countRows] = await Promise.all([
      selectComment()
        .where(where)
        .orderBy(...orderBy)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(t.comments).where(where),
    ]);

    const rootIds = roots.map((r) => r.id);
    let replyRows: CommentJoinRow[] = [];

    if (rootIds.length > 0) {
      // 每楼只取前 3 条，用窗口函数在一次查询里完成。
      const ranked = await sqlRows<{ id: string }>(sql`
        SELECT id FROM (
          SELECT c.id, row_number() OVER (PARTITION BY c.root_id ORDER BY c.created_at ASC) AS rn
          FROM comments c
          WHERE c.root_id = any(${uuidArray(rootIds)}) AND c.parent_id IS NOT NULL AND c.status = 'visible'
        ) ranked WHERE rn <= 3
      `);
      const replyIds = ranked.map((r) => r.id);
      if (replyIds.length > 0) {
        replyRows = (await selectComment()
          .where(inArray(t.comments.id, replyIds))
          .orderBy(asc(t.comments.createdAt))) as CommentJoinRow[];
      }
    }

    const allIds = [...rootIds, ...replyRows.map((r) => r.id)];
    const likedIds = await loadLikedIds(allIds, req.auth?.id ?? null);

    const repliesByRoot = new Map<string, Comment[]>();
    for (const row of replyRows) {
      const key = row.rootId ?? '';
      const list = repliesByRoot.get(key) ?? [];
      list.push(toComment(row, likedIds));
      repliesByRoot.set(key, list);
    }

    const items = (roots as CommentJoinRow[]).map((row) =>
      toComment(row, likedIds, repliesByRoot.get(row.id) ?? []),
    );

    ok(res, paginated(items, Number(countRows[0]?.total ?? 0), q.page, q.pageSize));
  }),
);

/** 展开某一楼的全部回复 */
commentsRouter.get(
  '/:rootId/replies',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20)));

    const where = and(
      eq(t.comments.rootId, req.params.rootId!),
      sql`${t.comments.parentId} is not null`,
      eq(t.comments.status, 'visible'),
    );

    const [rows, countRows] = await Promise.all([
      selectComment()
        .where(where)
        .orderBy(asc(t.comments.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(t.comments).where(where),
    ]);

    const likedIds = await loadLikedIds(rows.map((r) => r.id), req.auth?.id ?? null);
    ok(
      res,
      paginated(
        (rows as CommentJoinRow[]).map((r) => toComment(r, likedIds)),
        Number(countRows[0]?.total ?? 0),
        page,
        pageSize,
      ),
    );
  }),
);

commentsRouter.post(
  '/',
  requireAuth,
  writeLimiter,
  validate({ body: createCommentSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ videoId: string; content: string; parentId?: string | null }>(req);
    const settings = await getSiteSettings();
    const video = await requireVideo(input.videoId);

    let rootId: string | null = null;
    let replyToUserId: string | null = null;

    if (input.parentId) {
      const [parent] = await db
        .select({ id: t.comments.id, rootId: t.comments.rootId, userId: t.comments.userId, videoId: t.comments.videoId })
        .from(t.comments)
        .where(eq(t.comments.id, input.parentId))
        .limit(1);
      if (!parent) throw AppError.notFound('要回复的评论不存在');
      if (parent.videoId !== video.id) throw AppError.badRequest('评论与视频不匹配');
      // 无论回复的是几层，统一挂到根节点下，保持两级展示结构。
      rootId = parent.rootId ?? parent.id;
      replyToUserId = parent.userId;
    }

    const status = settings.commentsRequireApproval ? ('pending' as const) : ('visible' as const);

    const [comment] = await db
      .insert(t.comments)
      .values({
        videoId: video.id,
        userId: req.auth!.id,
        parentId: input.parentId ?? null,
        rootId,
        replyToUserId,
        content: input.content.trim(),
        status,
        ip: clientIp(req).slice(0, 64),
      })
      .returning();

    if (status === 'visible') {
      await db
        .update(t.videos)
        .set({ commentCount: sql`${t.videos.commentCount} + 1` })
        .where(eq(t.videos.id, video.id));
      if (rootId) {
        await db
          .update(t.comments)
          .set({ replyCount: sql`${t.comments.replyCount} + 1` })
          .where(eq(t.comments.id, rootId));
      }
      void recordBehavior(req.auth!.id, video.id, 'comment');
    }

    const [row] = (await selectComment().where(eq(t.comments.id, comment!.id)).limit(1)) as CommentJoinRow[];
    ok(
      res,
      toComment(row!, new Set()),
      status === 'pending' ? '评论已提交，等待审核' : '评论成功',
    );
  }),
);

commentsRouter.post(
  '/:id/like',
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const commentId = req.params.id!;
    const userId = req.auth!.id;

    const liked = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ x: sql`1` })
        .from(t.commentLikes)
        .where(and(eq(t.commentLikes.commentId, commentId), eq(t.commentLikes.userId, userId)))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .delete(t.commentLikes)
          .where(and(eq(t.commentLikes.commentId, commentId), eq(t.commentLikes.userId, userId)));
        await tx
          .update(t.comments)
          .set({ likeCount: sql`greatest(0, ${t.comments.likeCount} - 1)` })
          .where(eq(t.comments.id, commentId));
        return false;
      }

      await tx.insert(t.commentLikes).values({ commentId, userId });
      await tx
        .update(t.comments)
        .set({ likeCount: sql`${t.comments.likeCount} + 1` })
        .where(eq(t.comments.id, commentId));
      return true;
    });

    const [row] = await db
      .select({ likeCount: t.comments.likeCount })
      .from(t.comments)
      .where(eq(t.comments.id, commentId))
      .limit(1);

    ok(res, { liked, likeCount: row?.likeCount ?? 0 });
  }),
);

commentsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [comment] = await db.select().from(t.comments).where(eq(t.comments.id, req.params.id!)).limit(1);
    if (!comment) throw AppError.notFound('评论不存在');

    const isOwner = comment.userId === req.auth!.id;
    if (!isOwner && req.auth!.role !== 'admin') throw AppError.forbidden('无权删除该评论');

    await db.transaction(async (tx) => {
      await tx.update(t.comments).set({ status: 'deleted' }).where(eq(t.comments.id, comment.id));
      if (comment.status === 'visible') {
        await tx
          .update(t.videos)
          .set({ commentCount: sql`greatest(0, ${t.videos.commentCount} - 1)` })
          .where(eq(t.videos.id, comment.videoId));
        if (comment.rootId) {
          await tx
            .update(t.comments)
            .set({ replyCount: sql`greatest(0, ${t.comments.replyCount} - 1)` })
            .where(eq(t.comments.id, comment.rootId));
        }
      }
    });

    ok(res, null, '评论已删除');
  }),
);

commentsRouter.post(
  '/:id/report',
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    await db
      .update(t.comments)
      .set({ reportCount: sql`${t.comments.reportCount} + 1` })
      .where(eq(t.comments.id, req.params.id!));
    ok(res, null, '举报已提交，我们会尽快处理');
  }),
);
