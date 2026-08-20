import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  PLAYABLE_VIDEO_STATUSES,
  slugify,
  evaluateGate,
  type SortOption,
  type CaptionTrack,
  type VideoDetail,
  type VideoSummary,
} from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { captionPublicUrl } from '../storage/keys.js';

export type VideoRow = typeof t.videos.$inferSelect;

export interface VideoRelations {
  category: { id: string; slug: string; name: string } | null;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
  tags: { id: string; slug: string; name: string }[];
}

/** 列表页的选择列。刻意不取 description 全文以外的重字段，保持行宽可控。 */
const summaryColumns = {
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
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: (typeof summaryColumns)[K] extends { _: { data: infer D } } ? D : never;
};

/** 一次性把多个视频的标签查出来，避免 N+1。 */
export async function loadTagsFor(videoIds: string[]): Promise<Map<string, VideoRelations['tags']>> {
  const map = new Map<string, VideoRelations['tags']>();
  if (videoIds.length === 0) return map;

  const rows = await db
    .select({
      videoId: t.videoTags.videoId,
      id: t.tags.id,
      slug: t.tags.slug,
      name: t.tags.name,
    })
    .from(t.videoTags)
    .innerJoin(t.tags, eq(t.tags.id, t.videoTags.tagId))
    .where(inArray(t.videoTags.videoId, videoIds));

  for (const row of rows) {
    const list = map.get(row.videoId) ?? [];
    list.push({ id: row.id, slug: row.slug, name: row.name });
    map.set(row.videoId, list);
  }
  return map;
}

export function toSummary(row: SummaryRow, tags: VideoRelations['tags'] = []): VideoSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    posterUrl: row.posterUrl,
    verticalPosterUrl: row.verticalPosterUrl,
    previewUrl: row.previewUrl,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    kind: row.kind,
    status: row.status,
    visibility: row.visibility,
    accessLevel: row.accessLevel,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
    commentCount: row.commentCount,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    category: row.categoryId && row.categorySlug
      ? { id: row.categoryId, slug: row.categorySlug, name: row.categoryName! }
      : null,
    author: row.authorId && row.authorUsername
      ? {
          id: row.authorId,
          username: row.authorUsername,
          displayName: row.authorDisplayName!,
          avatarUrl: row.authorAvatarUrl ?? null,
        }
      : null,
    tags,
  };
}

export interface ListVideosOptions {
  page: number;
  pageSize: number;
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  tag?: string;
  authorId?: string;
  accessLevel?: string;
  status?: string;
  visibility?: string;
  sort?: SortOption;
  minDuration?: number;
  maxDuration?: number;
  kind?: 'vod' | 'shorts';
  /** 后台列表要能看到草稿与转码中的内容，前台只看可播的公开内容。 */
  adminView?: boolean;
  excludeIds?: string[];
}

function buildOrderBy(sort: SortOption | undefined): SQL[] {
  switch (sort) {
    case 'popular':
      return [desc(t.videos.viewCount), desc(t.videos.publishedAt)];
    case 'most_liked':
      return [desc(t.videos.likeCount), desc(t.videos.publishedAt)];
    case 'longest':
      return [desc(t.videos.durationSeconds)];
    case 'shortest':
      return [asc(t.videos.durationSeconds)];
    case 'trending':
      // 简化版 Hacker News 排序：热度随时间衰减，兼顾新旧。
      return [
        sql`(${t.videos.viewCount} + ${t.videos.likeCount} * 5) / power(extract(epoch from (now() - coalesce(${t.videos.publishedAt}, ${t.videos.createdAt}))) / 3600 + 2, 1.5) DESC`,
      ];
    case 'latest':
    default:
      return [desc(sql`coalesce(${t.videos.publishedAt}, ${t.videos.createdAt})`)];
  }
}

export function buildVideoFilters(options: ListVideosOptions): SQL[] {
  const filters: SQL[] = [];

  if (!options.adminView) {
    filters.push(inArray(t.videos.status, [...PLAYABLE_VIDEO_STATUSES]));
    filters.push(eq(t.videos.visibility, 'public'));
    // 括号不能省：drizzle 用 AND 串联各条件，裸 OR 会把前面的过滤全部短路掉。
    filters.push(sql`(${t.videos.publishedAt} is null or ${t.videos.publishedAt} <= now())`);
  } else {
    if (options.status) filters.push(eq(t.videos.status, options.status as VideoRow['status']));
    if (options.visibility) filters.push(eq(t.videos.visibility, options.visibility as VideoRow['visibility']));
  }

  if (options.categoryId) filters.push(eq(t.videos.categoryId, options.categoryId));
  if (options.authorId) filters.push(eq(t.videos.authorId, options.authorId));
  if (options.accessLevel) filters.push(eq(t.videos.accessLevel, options.accessLevel as VideoRow['accessLevel']));
  if (options.minDuration !== undefined) filters.push(gte(t.videos.durationSeconds, options.minDuration));
  if (options.maxDuration !== undefined) filters.push(lte(t.videos.durationSeconds, options.maxDuration));
  if (options.kind) {
    filters.push(eq(t.videos.kind, options.kind));
  }
  if (options.excludeIds?.length) {
    filters.push(sql`${t.videos.id} <> all(${uuidArray(options.excludeIds)})`);
  }

  if (options.categorySlug) {
    filters.push(sql`${t.videos.categoryId} in (select id from categories where slug = ${options.categorySlug})`);
  }

  if (options.tag) {
    filters.push(
      sql`exists (
        select 1 from video_tags vt
        join tags tg on tg.id = vt.tag_id
        where vt.video_id = ${t.videos.id} and (tg.slug = ${options.tag} or tg.name = ${options.tag})
      )`,
    );
  }

  if (options.q) {
    const keyword = options.q.trim();
    if (keyword) {
      // 双路匹配：tsvector 负责词级精确，trigram/ILIKE 负责中文子串与错拼。
      filters.push(
        sql`(
          ${t.videos.title} ILIKE ${'%' + keyword + '%'}
          OR ${t.videos.description} ILIKE ${'%' + keyword + '%'}
          OR search_vector @@ plainto_tsquery('simple', ${keyword})
        )`,
      );
    }
  }

  return filters;
}

export async function listVideos(options: ListVideosOptions): Promise<{ items: VideoSummary[]; total: number }> {
  const filters = buildVideoFilters(options);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const orderBy = options.q
    ? [
        // 有关键词时优先按相关度排序：标题命中 > 全文匹配度 > 热度。
        sql`(case when ${t.videos.title} ILIKE ${'%' + options.q.trim() + '%'} then 1 else 0 end) DESC`,
        sql`ts_rank(search_vector, plainto_tsquery('simple', ${options.q.trim()})) DESC`,
        desc(t.videos.viewCount),
      ]
    : buildOrderBy(options.sort);

  const [rows, countResult] = await Promise.all([
    db
      .select(summaryColumns)
      .from(t.videos)
      .leftJoin(t.categories, eq(t.categories.id, t.videos.categoryId))
      .leftJoin(t.users, eq(t.users.id, t.videos.authorId))
      .where(where)
      .orderBy(...orderBy)
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.videos).where(where),
  ]);

  const tagMap = await loadTagsFor(rows.map((r) => r.id));
  return {
    items: rows.map((row) => toSummary(row as SummaryRow, tagMap.get(row.id) ?? [])),
    total: Number(countResult[0]?.total ?? 0),
  };
}

/** 按 ID 批量取摘要，保持传入顺序（推荐流依赖这个顺序）。 */
export async function getSummariesByIds(ids: string[]): Promise<VideoSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(summaryColumns)
    .from(t.videos)
    .leftJoin(t.categories, eq(t.categories.id, t.videos.categoryId))
    .leftJoin(t.users, eq(t.users.id, t.videos.authorId))
    .where(inArray(t.videos.id, ids));

  const tagMap = await loadTagsFor(rows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, toSummary(r as SummaryRow, tagMap.get(r.id) ?? [])]));
  return ids.map((id) => byId.get(id)).filter((v): v is VideoSummary => Boolean(v));
}

export async function findVideoByIdOrSlug(idOrSlug: string): Promise<VideoRow | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const [row] = await db
    .select()
    .from(t.videos)
    .where(isUuid ? eq(t.videos.id, idOrSlug) : eq(t.videos.slug, idOrSlug))
    .limit(1);
  return row ?? null;
}

export interface ViewerState {
  liked: boolean;
  favorited: boolean;
  following: boolean;
  resumeSeconds: number;
}

export async function loadViewerState(videoId: string, authorId: string | null, userId: string | null): Promise<ViewerState> {
  if (!userId) return { liked: false, favorited: false, following: false, resumeSeconds: 0 };

  const [likes, favs, follows, history] = await Promise.all([
    db
      .select({ x: sql`1` })
      .from(t.videoLikes)
      .where(and(eq(t.videoLikes.videoId, videoId), eq(t.videoLikes.userId, userId)))
      .limit(1),
    db
      .select({ x: sql`1` })
      .from(t.favorites)
      .where(and(eq(t.favorites.videoId, videoId), eq(t.favorites.userId, userId)))
      .limit(1),
    authorId
      ? db
          .select({ x: sql`1` })
          .from(t.follows)
          .where(and(eq(t.follows.followerId, userId), eq(t.follows.followeeId, authorId)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ position: t.watchHistory.positionSeconds })
      .from(t.watchHistory)
      .where(and(eq(t.watchHistory.userId, userId), eq(t.watchHistory.videoId, videoId)))
      .limit(1),
  ]);

  return {
    liked: likes.length > 0,
    favorited: favs.length > 0,
    following: follows.length > 0,
    resumeSeconds: Math.floor(history[0]?.position ?? 0),
  };
}

export type { GateResult } from '@videox/shared';
export { evaluateGate };

export async function buildVideoDetail(
  video: VideoRow,
  viewer: { userId: string | null; isVip: boolean; isAdmin: boolean },
): Promise<VideoDetail> {

  const [related] = await db
    .select({
      categorySlug: t.categories.slug,
      categoryName: t.categories.name,
      authorUsername: t.users.username,
      authorDisplayName: t.users.displayName,
      authorAvatarUrl: t.users.avatarUrl,
    })
    .from(t.videos)
    .leftJoin(t.categories, eq(t.categories.id, t.videos.categoryId))
    .leftJoin(t.users, eq(t.users.id, t.videos.authorId))
    .where(eq(t.videos.id, video.id))
    .limit(1);

  const tagMap = await loadTagsFor([video.id]);
  const viewerState = await loadViewerState(video.id, video.authorId, viewer.userId);
  const gate = evaluateGate(video, viewer);
  const captions = await listCaptionTracks(video.id);

  const summary = toSummary(
    {
      ...video,
      categorySlug: related?.categorySlug ?? null,
      categoryName: related?.categoryName ?? null,
      authorUsername: related?.authorUsername ?? null,
      authorDisplayName: related?.authorDisplayName ?? null,
      authorAvatarUrl: related?.authorAvatarUrl ?? null,
    } as unknown as SummaryRow,
    tagMap.get(video.id) ?? [],
  );

  return {
    ...summary,
    renditions: (video.renditions ?? []).map((r) => ({
      name: r.name,
      height: r.height,
      width: r.width,
      bandwidth: r.bandwidth,
      ready: r.ready,
    })),
    spriteUrl: video.spriteUrl,
    spriteVttUrl: video.spriteVttUrl,
    isEncrypted: video.isEncrypted,
    previewSeconds: 0,
    viewer: { ...viewerState, canPlay: gate.canPlay, gateReason: gate.gateReason },
    captions,
  };
}

export async function listCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const rows = await db
    .select({
      lang: t.videoCaptions.lang,
      format: t.videoCaptions.format,
    })
    .from(t.videoCaptions)
    .where(eq(t.videoCaptions.videoId, videoId))
    .orderBy(asc(t.videoCaptions.lang));
  return rows.map((row) => ({
    lang: row.lang,
    format: row.format,
    url: captionPublicUrl(videoId, row.lang, row.format),
  }));
}

/** slug 唯一性：冲突时追加短随机后缀，而不是抛错打断上传流程。 */
export async function generateUniqueSlug(title: string, videoId?: string): Promise<string> {
  const base = slugify(title) || 'video';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    const [existing] = await db
      .select({ id: t.videos.id })
      .from(t.videos)
      .where(eq(t.videos.slug, candidate))
      .limit(1);
    if (!existing || existing.id === videoId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function bumpViewCount(videoId: string): Promise<void> {
  await db
    .update(t.videos)
    .set({ viewCount: sql`${t.videos.viewCount} + 1` })
    .where(eq(t.videos.id, videoId));
}

export async function requireVideo(idOrSlug: string): Promise<VideoRow> {
  const video = await findVideoByIdOrSlug(idOrSlug);
  if (!video) throw AppError.notFound('视频不存在');
  return video;
}

export async function assertPlayable(video: VideoRow): Promise<void> {
  if (!PLAYABLE_VIDEO_STATUSES.includes(video.status)) {
    throw new AppError({
      message: video.status === 'failed' ? '该视频转码失败，暂时无法播放' : '视频正在处理中，请稍后再试',
      code: ErrorCode.VIDEO_NOT_READY,
      status: 409,
    });
  }
}

/**
 * 同步标签：先按名字 upsert 到 tags 表，再重建关联并修正计数。
 */
export async function syncVideoTags(videoId: string, tagNames: string[]): Promise<void> {
  const names = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))].slice(0, 20);

  await db.transaction(async (tx) => {
    const oldLinks = await tx
      .select({ tagId: t.videoTags.tagId })
      .from(t.videoTags)
      .where(eq(t.videoTags.videoId, videoId));

    await tx.delete(t.videoTags).where(eq(t.videoTags.videoId, videoId));

    let newTagIds: string[] = [];
    if (names.length > 0) {
      const inserted = await tx
        .insert(t.tags)
        .values(names.map((name) => ({ slug: slugify(name) || name.toLowerCase(), name })))
        .onConflictDoUpdate({ target: t.tags.slug, set: { name: sql`excluded.name` } })
        .returning({ id: t.tags.id });
      newTagIds = inserted.map((r) => r.id);
      await tx.insert(t.videoTags).values(newTagIds.map((tagId) => ({ videoId, tagId }))).onConflictDoNothing();
    }

    const affected = [...new Set([...oldLinks.map((l) => l.tagId), ...newTagIds])];
    if (affected.length > 0) {
      await tx.execute(sql`
        UPDATE tags SET video_count = coalesce(sub.c, 0)
        FROM (
          SELECT tg.id, count(vt.video_id)::int AS c
          FROM tags tg LEFT JOIN video_tags vt ON vt.tag_id = tg.id
          WHERE tg.id = any(${uuidArray(affected)})
          GROUP BY tg.id
        ) sub
        WHERE tags.id = sub.id
      `);
    }
  });
}

export async function refreshCategoryCounts(categoryIds: (string | null)[]): Promise<void> {
  const ids = categoryIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await sqlRows(sql`
    UPDATE categories SET video_count = coalesce(sub.c, 0)
    FROM (
      SELECT c.id, count(v.id)::int AS c
      FROM categories c
      LEFT JOIN videos v ON v.category_id = c.id AND v.status IN ('ready','partially_ready') AND v.visibility = 'public'
      WHERE c.id = any(${uuidArray(ids)})
      GROUP BY c.id
    ) sub
    WHERE categories.id = sub.id
  `);
}
