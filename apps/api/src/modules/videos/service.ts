import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_PREVIEW_SECONDS,
  PLAYABLE_VIDEO_STATUSES,
  slugify,
  type SortOption,
  type VideoDetail,
  type VideoSummary,
} from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { getSiteSettings } from '../settings/service.js';

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
  status: t.videos.status,
  visibility: t.videos.visibility,
  accessLevel: t.videos.accessLevel,
  kind: t.videos.kind,
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
    status: row.status,
    visibility: row.visibility,
    accessLevel: row.accessLevel,
    kind: row.kind,
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
  orientation?: 'vertical' | 'horizontal';
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
  if (options.kind) filters.push(eq(t.videos.kind, options.kind));
  if (options.minDuration !== undefined) filters.push(gte(t.videos.durationSeconds, options.minDuration));
  if (options.maxDuration !== undefined) filters.push(lte(t.videos.durationSeconds, options.maxDuration));
  if (options.orientation === 'vertical') {
    filters.push(sql`${t.videos.width} is not null and ${t.videos.height} is not null and ${t.videos.height} > ${t.videos.width}`);
  } else if (options.orientation === 'horizontal') {
    filters.push(sql`${t.videos.width} is not null and ${t.videos.height} is not null and ${t.videos.width} >= ${t.videos.height}`);
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
