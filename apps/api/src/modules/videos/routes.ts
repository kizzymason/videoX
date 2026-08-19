import { Router } from 'express';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  PLAYABLE_VIDEO_STATUSES,
  decideShortsTrial,
  playTicketSchema,
  videoListQuerySchema,
  type PlaybackTicket,
  type ShortsTrialQuota,
  type VideoSummary,
} from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok, paginated } from '../../core/respond.js';
import { assertVipFresh, optionalAuth, requireAuth } from '../../middleware/auth.js';
import { playbackLimiter } from '../../middleware/request-context.js';
import { query, validate } from '../../middleware/validate.js';
import { getSiteSettings } from '../settings/service.js';
import { issuePlayToken } from '../media/play-token.js';
import { PLAY_TOKEN_PARAM } from '../media/play-token.js';
import {
  assertPlayable,
  buildVideoDetail,
  bumpViewCount,
  evaluateGate,
  listVideos,
  loadTagsFor,
  requireVideo,
  toSummary,
} from './service.js';
import { recordImpressions } from '../recommend/service.js';
import { loadShortsTrialIds, persistShortsTrialIds } from './shorts-trial.js';

export const videosRouter: Router = Router();

videosRouter.get(
  '/',
  optionalAuth,
  validate({ query: videoListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      q?: string;
      categoryId?: string;
      categorySlug?: string;
      tag?: string;
      authorId?: string;
      accessLevel?: string;
      sort: 'recommended' | 'latest' | 'popular' | 'trending' | 'most_liked' | 'longest' | 'shortest';
      minDuration?: number;
      maxDuration?: number;
      orientation?: 'vertical' | 'horizontal';
      kind?: 'vod' | 'shorts';
    }>(req);

    // 首页点播目录不混 Shorts：忽略客户端 orientation/kind，强制横屏 + vod。
    const result = await listVideos({ ...q, adminView: false, orientation: 'horizontal', kind: 'vod' });

    if (req.auth && result.items.length > 0) {
      void recordImpressions(req.auth.id, result.items.map((v) => v.id));
    }

    ok(res, paginated(result.items, result.total, q.page, q.pageSize));
  }),
);

/** Shorts：只出竖屏。库存为空就空，不再回落点播。必须挂在 /:idOrSlug 前面。 */
videosRouter.get(
  '/shorts',
  optionalAuth,
  validate({ query: videoListQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = query<{
      page: number;
      pageSize: number;
      sort: 'recommended' | 'latest' | 'popular' | 'trending' | 'most_liked' | 'longest' | 'shortest';
    }>(req);
    const result = await listVideos({
      ...q,
      adminView: false,
      orientation: 'vertical',
      kind: 'shorts',
    });
    if (req.auth && result.items.length > 0) {
      void recordImpressions(req.auth.id, result.items.map((v) => v.id));
    }
    ok(res, paginated(result.items, result.total, q.page, q.pageSize));
  }),
);

videosRouter.get(
  '/:idOrSlug',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.idOrSlug!);

    const isAdmin = req.auth?.role === 'admin';
    const isOwner = req.auth?.id === video.authorId;
    if (!isAdmin && !isOwner) {
      if (video.visibility === 'private') throw AppError.notFound('视频不存在');
      if (!PLAYABLE_VIDEO_STATUSES.includes(video.status)) throw AppError.notFound('视频尚未发布');
    }

    const detail = await buildVideoDetail(video, {
      userId: req.auth?.id ?? null,
      isVip: req.auth?.isVip ?? false,
      isAdmin: isAdmin ?? false,
    });

    ok(res, detail);
  }),
);

/** 相关推荐：同分类 + 标签重合度优先，回落到热门。 */
videosRouter.get(
  '/:id/related',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    const limit = Math.min(24, Number(req.query.limit ?? 12));

    const rows = await sqlRows<{ id: string; score: number }>(sql`
      WITH target_tags AS (
        SELECT tag_id FROM video_tags WHERE video_id = ${video.id}
      )
      SELECT v.id,
             (CASE WHEN v.category_id = ${video.categoryId}::uuid THEN 2.0 ELSE 0 END)
             + coalesce((SELECT count(*) FROM video_tags vt WHERE vt.video_id = v.id AND vt.tag_id IN (SELECT tag_id FROM target_tags)), 0) * 1.5
             + (CASE WHEN v.author_id = ${video.authorId}::uuid THEN 1.0 ELSE 0 END)
             + ln(greatest(v.view_count, 1)) * 0.15 AS score
      FROM videos v
      WHERE v.id <> ${video.id}
        AND v.status IN ('ready','partially_ready')
        AND v.visibility = 'public'
        AND v.kind = 'vod'
      ORDER BY score DESC, v.published_at DESC NULLS LAST
      LIMIT ${limit}
    `);

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      ok(res, [] satisfies VideoSummary[]);
      return;
    }

    const details = await db
      .select({
        id: t.videos.id,
        slug: t.videos.slug,
        title: t.videos.title,
        description: t.videos.description,
        posterUrl: t.videos.posterUrl,
        verticalPosterUrl: t.videos.verticalPosterUrl,
        previewUrl: t.videos.previewUrl,
        durationSeconds: t.videos.durationSeconds,
        width: t.videos.width,
        height: t.videos.height,
        kind: t.videos.kind,
        status: t.videos.status,
        visibility: t.videos.visibility,
        accessLevel: t.videos.accessLevel,
        viewCount: t.videos.viewCount,
        likeCount: t.videos.likeCount,
        favoriteCount: t.videos.favoriteCount,
        commentCount: t.videos.commentCount,
        publishedAt: t.videos.publishedAt,
        createdAt: t.videos.createdAt,
        categoryId: t.videos.categoryId,
        authorId: t.videos.authorId,
        categorySlug: t.categories.slug,
        categoryName: t.categories.name,
        authorUsername: t.users.username,
        authorDisplayName: t.users.displayName,
        authorAvatarUrl: t.users.avatarUrl,
      })
      .from(t.videos)
      .leftJoin(t.categories, eq(t.categories.id, t.videos.categoryId))
      .leftJoin(t.users, eq(t.users.id, t.videos.authorId))
      .where(sql`${t.videos.id} = any(${uuidArray(ids)})`);

    const tagMap = await loadTagsFor(ids);
    const byId = new Map(details.map((d) => [d.id, toSummary(d as never, tagMap.get(d.id) ?? [])]));
    ok(res, ids.map((id) => byId.get(id)).filter(Boolean));
  }),
);

async function consumeShortsTrial(
  req: Parameters<typeof loadShortsTrialIds>[0],
  res: Parameters<typeof persistShortsTrialIds>[0],
  videoId: string,
  userId: string | undefined,
): Promise<ShortsTrialQuota> {
  const settings = await getSiteSettings();
  const limit = settings.shortsFreeCount;
  const watched = await loadShortsTrialIds(req, userId);
  const decision = decideShortsTrial(watched, videoId, limit);
  const shortsTrial: ShortsTrialQuota = { used: decision.used, limit, remaining: decision.remaining };
  if (!decision.allow) {
    throw AppError.vipRequired('免费试看已用完，订阅后即可继续观看', { shortsTrial });
  }
  await persistShortsTrialIds(res, decision.nextIds, userId);
  return shortsTrial;
}

/**
 * 播放票据。这是进入媒体链路的唯一入口：
 * 校验门禁 → 签发短寿命 token → 返回带签名的 master.m3u8 地址。
 * 点播不再发按秒试看票；Shorts 非会员按条计数，满额 402。
 */
videosRouter.post(
  '/:id/play-ticket',
  optionalAuth,
  playbackLimiter,
  validate({ params: playTicketSchema.extend({}).partial() }),
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    await assertPlayable(video);

    const isAdmin = req.auth?.role === 'admin';
    // 会员权益回源数据库确认，不信任 access token 里的 vipExp 快照——
    // 否则刚兑换完卡密的用户要等 token 过期才能看，退款/封禁也会有窗口期。
    const isVip = req.auth ? await assertVipFresh(req) : false;
    const gate = evaluateGate(video, {
      userId: req.auth?.id ?? null,
      isVip,
      isAdmin: isAdmin ?? false,
    });

    let shortsTrial: ShortsTrialQuota | undefined;
    if (video.kind === 'shorts' && !isVip && !isAdmin) {
      shortsTrial = await consumeShortsTrial(req, res, video.id, req.auth?.id);
    } else if (!gate.canPlay) {
      if (gate.gateReason === 'vip_required') throw AppError.vipRequired('订阅后即可播放');
      throw AppError.notFound('视频暂不可播放');
    }

    const signed = issuePlayToken({
      req,
      videoId: video.id,
      userId: req.auth?.id ?? null,
      scope: 'full',
    });

    let resumeSeconds = 0;
    if (req.auth) {
      const [history] = await db
        .select({ position: t.watchHistory.positionSeconds })
        .from(t.watchHistory)
        .where(and(eq(t.watchHistory.userId, req.auth.id), eq(t.watchHistory.videoId, video.id)))
        .limit(1);
      resumeSeconds = Math.floor(history?.position ?? 0);
      // 已经看到结尾就不要再「续播」到片尾了。
      if (video.durationSeconds > 0 && resumeSeconds > video.durationSeconds - 15) resumeSeconds = 0;
    }

    void bumpViewCount(video.id);

    const masterUrl = `${env.API_PUBLIC_URL}/media/hls/${video.id}/master.m3u8?${PLAY_TOKEN_PARAM}=${encodeURIComponent(signed.token)}`;

    const ticket: PlaybackTicket = {
      videoId: video.id,
      masterUrl,
      token: signed.token,
      expiresAt: signed.expiresAt.toISOString(),
      ttlSeconds: signed.ttlSeconds,
      isEncrypted: video.isEncrypted,
      previewSeconds: null,
      resumeSeconds,
      spriteVttUrl: video.spriteVttUrl,
      renditions: (video.renditions ?? []).map((r) => ({
        name: r.name,
        height: r.height,
        width: r.width,
        bandwidth: r.bandwidth,
        ready: r.ready,
      })),
      ...(shortsTrial ? { shortsTrial } : {}),
    };

    ok(res, ticket);
  }),
);

/** 续签：播放中 token 快过期时静默换新，不打断播放。 */
videosRouter.post(
  '/:id/renew-ticket',
  optionalAuth,
  playbackLimiter,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);

    const isAdmin = req.auth?.role === 'admin';
    const isVip = req.auth ? await assertVipFresh(req) : false;
    const gate = evaluateGate(video, { userId: req.auth?.id ?? null, isVip, isAdmin: isAdmin ?? false });

    if (video.kind === 'shorts' && !isVip && !isAdmin) {
      const settings = await getSiteSettings();
      const watched = await loadShortsTrialIds(req, req.auth?.id);
      const decision = decideShortsTrial(watched, video.id, settings.shortsFreeCount);
      // 续签不得新占名额，避免绕过 play-ticket 扣次。
      if (!decision.already) {
        throw AppError.vipRequired('免费试看已用完，订阅后即可继续观看', {
          shortsTrial: { used: decision.used, limit: settings.shortsFreeCount, remaining: decision.remaining },
        });
      }
    } else if (!gate.canPlay) {
      throw AppError.forbidden('播放权限已失效');
    }

    const signed = issuePlayToken({
      req,
      videoId: video.id,
      userId: req.auth?.id ?? null,
      scope: 'full',
    });
    ok(res, {
      token: signed.token,
      scope: signed.claims.scope,
      previewSeconds: null,
      expiresAt: signed.expiresAt.toISOString(),
      ttlSeconds: signed.ttlSeconds,
      masterUrl: `${env.API_PUBLIC_URL}/media/hls/${video.id}/master.m3u8?${PLAY_TOKEN_PARAM}=${encodeURIComponent(signed.token)}`,
    });
  }),
);

/** 作者的其它作品 */
videosRouter.get(
  '/:id/more-from-author',
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    if (!video.authorId) {
      ok(res, []);
      return;
    }
    const result = await listVideos({
      page: 1,
      pageSize: Math.min(12, Number(req.query.limit ?? 8)),
      authorId: video.authorId,
      sort: 'latest',
      excludeIds: [video.id],
      kind: 'vod',
    });
    ok(res, result.items);
  }),
);

/** 上传者查看自己视频的转码进度 */
videosRouter.get(
  '/:id/transcode-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const video = await requireVideo(req.params.id!);
    if (video.authorId !== req.auth!.id && req.auth!.role !== 'admin') {
      throw AppError.forbidden('无权查看');
    }

    const [job] = await db
      .select()
      .from(t.transcodeJobs)
      .where(eq(t.transcodeJobs.videoId, video.id))
      .orderBy(desc(t.transcodeJobs.createdAt))
      .limit(1);

    ok(res, {
      videoStatus: video.status,
      job: job
        ? {
            id: job.id,
            status: job.status,
            progress: job.progress,
            stage: job.stage,
            currentRendition: job.currentRendition,
            completedRenditions: job.completedRenditions,
            errorMessage: job.errorMessage,
          }
        : null,
      renditions: video.renditions,
    });
  }),
);
