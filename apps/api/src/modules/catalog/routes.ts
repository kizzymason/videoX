import { Router } from 'express';
import { and, desc, eq, gte, lte, or, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { paginationSchema, type Banner, type Category, type Tag } from '@videox/shared';
import { db, t, sqlRows } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { optionalAuth } from '../../middleware/auth.js';
import { query, validate } from '../../middleware/validate.js';
import { cached } from '../../core/redis.js';
import { listVideos } from '../videos/service.js';
import { getSiteSettings } from '../settings/service.js';
import { getCatalogHome } from './home.js';

export const catalogRouter: Router = Router();

function toCategory(row: typeof t.categories.$inferSelect): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    coverUrl: row.coverUrl,
    icon: row.icon,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    videoCount: row.videoCount,
  };
}

catalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const items = await cached('catalog:categories', 120, async () => {
      const rows = await db
        .select()
        .from(t.categories)
        .where(eq(t.categories.isActive, true))
        .orderBy(t.categories.sortOrder, t.categories.name);
      return rows.map(toCategory);
    });
    ok(res, items);
  }),
);

catalogRouter.get(
  '/categories/:slug',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(t.categories).where(eq(t.categories.slug, req.params.slug!)).limit(1);
    if (!row) throw AppError.notFound('分类不存在');
    ok(res, toCategory(row));
  }),
);

catalogRouter.get(
  '/tags',
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 60));
    const items = await cached(`catalog:tags:${limit}`, 120, async () => {
      const rows = await db
        .select({ id: t.tags.id, slug: t.tags.slug, name: t.tags.name, videoCount: t.tags.videoCount })
        .from(t.tags)
        .orderBy(desc(t.tags.videoCount))
        .limit(limit);
      return rows satisfies Tag[];
    });
    ok(res, items);
  }),
);

catalogRouter.get(
  '/banners',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(t.banners)
      .where(
        and(
          eq(t.banners.isActive, true),
          or(isNull(t.banners.startsAt), lte(t.banners.startsAt, now)),
          or(isNull(t.banners.endsAt), gte(t.banners.endsAt, now)),
        ),
      )
      .orderBy(t.banners.sortOrder)
      .limit(12);

    ok(
      res,
      rows.map(
        (r): Banner => ({
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          imageUrl: r.imageUrl,
          mobileImageUrl: r.mobileImageUrl,
          linkUrl: r.linkUrl,
          videoId: r.videoId,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          startsAt: r.startsAt?.toISOString() ?? null,
          endsAt: r.endsAt?.toISOString() ?? null,
        }),
      ),
    );
  }),
);

catalogRouter.post(
  '/banners/:id/click',
  asyncHandler(async (req, res) => {
    await db
      .update(t.banners)
      .set({ clickCount: sql`${t.banners.clickCount} + 1` })
      .where(eq(t.banners.id, req.params.id!));
    ok(res, null);
  }),
);

/** 站点公开配置。前端启动时拉一次，用于标题、主题、备案号等。 */
catalogRouter.get(
  '/site',
  asyncHandler(async (_req, res) => {
    const settings = await getSiteSettings();
    ok(res, {
      siteName: settings.siteName,
      siteTagline: settings.siteTagline,
      siteDescription: settings.siteDescription,
      siteKeywords: settings.siteKeywords,
      logoUrl: settings.logoUrl,
      faviconUrl: settings.faviconUrl,
      defaultTheme: settings.defaultTheme,
      icpBeian: settings.icpBeian,
      footerText: settings.footerText,
      contactEmail: settings.contactEmail,
      allowRegistration: settings.allowRegistration,
      previewSeconds: 0,
      shortsFreeCount: settings.shortsFreeCount,
    });
  }),
);

/** 发现页组合。recommend 挂了仍出 latest / 7 日热门 / 分类精选，只出已通过可播。 */
catalogRouter.get(
  '/home',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const data = await getCatalogHome({ userId: req.auth?.id ?? null });
    ok(res, data);
  }),
);

// --------------------------------------------------------------------------
// 搜索
// --------------------------------------------------------------------------

const searchQuerySchema = paginationSchema.extend({
  q: z.string().min(1).max(120),
  categoryId: z.string().max(64).optional(),
  tag: z.string().max(80).optional(),
  sort: z.enum(['recommended', 'latest', 'popular', 'trending', 'most_liked', 'longest', 'shortest']).default('latest'),
  minDuration: z.coerce.number().int().min(0).optional(),
  maxDuration: z.coerce.number().int().min(0).optional(),
});

catalogRouter.get(
  '/search',
  optionalAuth,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      q: string;
      categoryId?: string;
      tag?: string;
      sort: 'latest';
      minDuration?: number;
      maxDuration?: number;
    }>(req);

    const result = await listVideos({ ...q, adminView: false, kind: 'vod' });
    ok(res, paginated(result.items, result.total, q.page, q.pageSize));
  }),
);

/**
 * 搜索联想。走 trigram 相似度，对中文子串和英文错拼都有效。
 * 结果混合视频标题与标签，前端分组展示。
 */
catalogRouter.get(
  '/search/suggest',
  asyncHandler(async (req, res) => {
    const keyword = String(req.query.q ?? '').trim().slice(0, 60);
    if (keyword.length === 0) {
      ok(res, { videos: [], tags: [] });
      return;
    }

    const [videos, tags] = await Promise.all([
      sqlRows<{ id: string; title: string; poster_url: string | null; view_count: number }>(sql`
        SELECT id, title, poster_url, view_count
        FROM videos
        WHERE status IN ('ready','partially_ready') AND visibility = 'public'
          AND kind = 'vod'
          AND (title ILIKE ${'%' + keyword + '%'} OR similarity(title, ${keyword}) > 0.15)
        ORDER BY (title ILIKE ${keyword + '%'}) DESC, similarity(title, ${keyword}) DESC, view_count DESC
        LIMIT 8
      `),
      sqlRows<{ name: string; slug: string; video_count: number }>(sql`
        SELECT name, slug, video_count
        FROM tags
        WHERE name ILIKE ${'%' + keyword + '%'} OR similarity(name, ${keyword}) > 0.2
        ORDER BY video_count DESC
        LIMIT 6
      `),
    ]);

    ok(res, {
      videos: videos.map((v) => ({
        id: v.id,
        title: v.title,
        posterUrl: v.poster_url,
        viewCount: Number(v.view_count),
      })),
      tags: tags.map((t2) => ({ name: t2.name, slug: t2.slug, videoCount: Number(t2.video_count) })),
    });
  }),
);

/** 热门搜索词，来自埋点。 */
catalogRouter.get(
  '/search/hot',
  asyncHandler(async (_req, res) => {
    const items = await cached('catalog:hot-search', 300, async () => {
      const rows = await sqlRows<{ keyword: string; c: number }>(sql`
        SELECT keyword, count(*)::int AS c
        FROM analytics_events
        WHERE event = 'search' AND keyword IS NOT NULL AND keyword <> ''
          AND created_at > now() - interval '7 days'
        GROUP BY keyword ORDER BY c DESC LIMIT 10
      `);
      return rows.map((r) => r.keyword);
    });
    ok(res, items);
  }),
);

// --------------------------------------------------------------------------
// 用户主页（频道）
// --------------------------------------------------------------------------

catalogRouter.get(
  '/users/:username',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db
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
      .from(t.users)
      .where(eq(t.users.usernameNormalized, req.params.username!.toLowerCase()))
      .limit(1);

    if (!user) throw AppError.notFound('用户不存在');

    let following = false;
    if (req.auth) {
      const rows = await db
        .select({ x: sql`1` })
        .from(t.follows)
        .where(and(eq(t.follows.followerId, req.auth.id), eq(t.follows.followeeId, user.id)))
        .limit(1);
      following = rows.length > 0;
    }

    const [stats] = await sqlRows<{ total_views: number }>(sql`
      SELECT coalesce(sum(view_count), 0)::bigint AS total_views
      FROM videos WHERE author_id = ${user.id} AND status IN ('ready','partially_ready')
    `);

    ok(res, {
      ...user,
      createdAt: user.createdAt.toISOString(),
      following,
      totalViews: Number(stats?.total_views ?? 0),
    });
  }),
);

catalogRouter.get(
  '/users/:username/videos',
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = query<{ page: number; pageSize: number }>(req);
    const [user] = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.usernameNormalized, req.params.username!.toLowerCase()))
      .limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    const result = await listVideos({ page, pageSize, authorId: user.id, sort: 'latest' });
    ok(res, paginated(result.items, result.total, page, pageSize));
  }),
);
