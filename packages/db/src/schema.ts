import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AccessLevel,
  AlgoWeights,
  CommentStatus,
  OrderSource,
  OrderStatus,
  RedeemCodeStatus,
  StorageDriver,
  SubscriptionStatus,
  TranscodeJobStatus,
  UserRole,
  UserStatus,
  CaptionFormat,
  VideoKind,
  VideoStatus,
  VideoVisibility,
} from '@videox/shared';

const now = sql`now()`;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 160 }),
    emailNormalized: varchar('email_normalized', { length: 160 }),
    username: varchar('username', { length: 32 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    bio: text('bio'),
    role: varchar('role', { length: 16 }).$type<UserRole>().notNull().default('user'),
    status: varchar('status', { length: 16 }).$type<UserStatus>().notNull().default('active'),
    vipExpiresAt: timestamp('vip_expires_at', { withTimezone: true }),
    followerCount: integer('follower_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
    videoCount: integer('video_count').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: varchar('last_login_ip', { length: 64 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_norm_uq').on(t.emailNormalized),
    uniqueIndex('users_username_norm_uq').on(t.usernameNormalized),
    index('users_role_idx').on(t.role),
    index('users_vip_expires_idx').on(t.vipExpiresAt),
    index('users_created_idx').on(t.createdAt),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    replacedById: uuid('replaced_by_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 80 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    description: text('description'),
    coverUrl: varchar('cover_url', { length: 500 }),
    icon: varchar('icon', { length: 60 }),
    parentId: uuid('parent_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    videoCount: integer('video_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('categories_slug_uq').on(t.slug),
    index('categories_parent_idx').on(t.parentId),
    index('categories_sort_idx').on(t.sortOrder),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 80 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    videoCount: integer('video_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [uniqueIndex('tags_slug_uq').on(t.slug), index('tags_count_idx').on(t.videoCount)],
);

export interface RenditionRecord {
  name: string;
  height: number;
  width: number;
  bandwidth: number;
  ready: boolean;
  playlist: string;
  sizeBytes?: number;
}

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 120 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 24 }).$type<VideoStatus>().notNull().default('draft'),
    visibility: varchar('visibility', { length: 16 }).$type<VideoVisibility>().notNull().default('public'),
    accessLevel: varchar('access_level', { length: 16 }).$type<AccessLevel>().notNull().default('vip'),
    sourceKey: varchar('source_key', { length: 500 }),
    sourceSizeBytes: bigint('source_size_bytes', { mode: 'number' }),
    sourceHash: varchar('source_hash', { length: 64 }),
    hlsDir: varchar('hls_dir', { length: 500 }),
    posterUrl: varchar('poster_url', { length: 500 }),
    verticalPosterUrl: varchar('vertical_poster_url', { length: 500 }),
    previewUrl: varchar('preview_url', { length: 500 }),
    spriteUrl: varchar('sprite_url', { length: 500 }),
    spriteVttUrl: varchar('sprite_vtt_url', { length: 500 }),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    kind: varchar('kind', { length: 16 }).$type<VideoKind>().notNull().default('vod'),
    fps: real('fps'),
    renditions: jsonb('renditions').$type<RenditionRecord[]>().notNull().default(sql`'[]'::jsonb`),
    isEncrypted: boolean('is_encrypted').notNull().default(false),
    outputBytes: bigint('output_bytes', { mode: 'number' }).notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    shareCount: integer('share_count').notNull().default(0),
    totalWatchSeconds: bigint('total_watch_seconds', { mode: 'number' }).notNull().default(0),
    completionRate: doublePrecision('completion_rate').notNull().default(0),
    qualityScore: doublePrecision('quality_score').notNull().default(0),
    aiScore: doublePrecision('ai_score'),
    aiReason: text('ai_reason'),
    aiScoredAt: timestamp('ai_scored_at', { withTimezone: true }),
    manualBoost: doublePrecision('manual_boost').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('videos_slug_uq').on(t.slug),
    index('videos_status_idx').on(t.status),
    index('videos_category_idx').on(t.categoryId),
    index('videos_author_idx').on(t.authorId),
    index('videos_published_idx').on(t.publishedAt),
    index('videos_views_idx').on(t.viewCount),
    index('videos_access_idx').on(t.accessLevel),
    index('videos_kind_idx').on(t.kind),
    index('videos_hash_idx').on(t.sourceHash),
    index('videos_ai_score_idx').on(t.aiScore),
  ],
);

export const videoTags = pgTable(
  'video_tags',
  {
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.tagId] }), index('video_tags_tag_idx').on(t.tagId)],
);

export const videoRenditions = pgTable(
  'video_renditions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 16 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bandwidth: integer('bandwidth').notNull(),
    playlistKey: varchar('playlist_key', { length: 500 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    durationSeconds: real('duration_seconds').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [uniqueIndex('video_renditions_uq').on(t.videoId, t.name)],
);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    fileHash: varchar('file_hash', { length: 64 }),
    chunkSize: integer('chunk_size').notNull(),
    totalChunks: integer('total_chunks').notNull(),
    receivedChunks: jsonb('received_chunks').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    tempDir: varchar('temp_dir', { length: 500 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('upload_sessions_user_idx').on(t.userId), index('upload_sessions_hash_idx').on(t.fileHash)],
);

export const transcodeJobs = pgTable(
  'transcode_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).$type<TranscodeJobStatus>().notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    stage: varchar('stage', { length: 60 }),
    currentRendition: varchar('current_rendition', { length: 16 }),
    completedRenditions: jsonb('completed_renditions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    queueJobId: varchar('queue_job_id', { length: 80 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('transcode_jobs_video_idx').on(t.videoId), index('transcode_jobs_status_idx').on(t.status)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    rootId: uuid('root_id'),
    replyToUserId: uuid('reply_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    status: varchar('status', { length: 16 }).$type<CommentStatus>().notNull().default('visible'),
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    pinned: boolean('pinned').notNull().default(false),
    reportCount: integer('report_count').notNull().default(0),
    ip: varchar('ip', { length: 64 }),
    ...timestamps,
  },
  (t) => [
    index('comments_video_idx').on(t.videoId, t.createdAt),
    index('comments_root_idx').on(t.rootId),
    index('comments_user_idx').on(t.userId),
    index('comments_status_idx').on(t.status),
  ],
);

export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export const videoLikes = pgTable(
  'video_likes',
  {
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.userId] }), index('video_likes_user_idx').on(t.userId, t.createdAt)],
);

export const favorites = pgTable(
  'favorites',
  {
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.userId] }), index('favorites_user_idx').on(t.userId, t.createdAt)],
);

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index('follows_followee_idx').on(t.followeeId, t.createdAt)],
);

export const watchHistory = pgTable(
  'watch_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    positionSeconds: real('position_seconds').notNull().default(0),
    durationSeconds: real('duration_seconds').notNull().default(0),
    watchedSeconds: real('watched_seconds').notNull().default(0),
    completed: boolean('completed').notNull().default(false),
    playCount: integer('play_count').notNull().default(1),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull().default(now),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    uniqueIndex('watch_history_uq').on(t.userId, t.videoId),
    index('watch_history_user_time_idx').on(t.userId, t.watchedAt),
    index('watch_history_video_idx').on(t.videoId),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    description: text('description'),
    durationDays: integer('duration_days').notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    originalPriceCents: integer('original_price_cents'),
    perks: jsonb('perks').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    badge: varchar('badge', { length: 20 }),
    isRecommended: boolean('is_recommended').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('plans_code_uq').on(t.code), index('plans_sort_idx').on(t.sortOrder)],
);

export const redeemCodes = pgTable(
  'redeem_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
    batchId: varchar('batch_id', { length: 64 }),
    status: varchar('status', { length: 16 }).$type<RedeemCodeStatus>().notNull().default('unused'),
    usedByUserId: uuid('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    note: varchar('note', { length: 200 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('redeem_codes_code_uq').on(t.code),
    index('redeem_codes_status_idx').on(t.status),
    index('redeem_codes_batch_idx').on(t.batchId),
    index('redeem_codes_plan_idx').on(t.planId),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).$type<SubscriptionStatus>().notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().default(now),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sourceOrderId: uuid('source_order_id'),
    ...timestamps,
  },
  (t) => [index('subscriptions_user_idx').on(t.userId, t.expiresAt), index('subscriptions_status_idx').on(t.status)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNo: varchar('order_no', { length: 40 }).notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull().default(0),
    source: varchar('source', { length: 20 }).$type<OrderSource>().notNull(),
    status: varchar('status', { length: 16 }).$type<OrderStatus>().notNull().default('paid'),
    redeemCodeId: uuid('redeem_code_id').references(() => redeemCodes.id, { onDelete: 'set null' }),
    channelPayload: jsonb('channel_payload').$type<Record<string, unknown>>(),
    note: varchar('note', { length: 200 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('orders_no_uq').on(t.orderNo), index('orders_user_idx').on(t.userId, t.createdAt), index('orders_created_idx').on(t.createdAt)],
);

export const banners = pgTable(
  'banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 120 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    imageUrl: varchar('image_url', { length: 500 }).notNull(),
    mobileImageUrl: varchar('mobile_image_url', { length: 500 }),
    linkUrl: varchar('link_url', { length: 500 }),
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('banners_active_sort_idx').on(t.isActive, t.sortOrder)],
);

export const settings = pgTable('settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
});

export const storageProfiles = pgTable(
  'storage_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 60 }).notNull(),
    driver: varchar('driver', { length: 16 }).$type<StorageDriver>().notNull(),
    isActive: boolean('is_active').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [index('storage_profiles_active_idx').on(t.isActive)],
);

export const aiProfiles = pgTable(
  'ai_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 60 }).notNull(),
    endpoint: varchar('endpoint', { length: 300 }).notNull(),
    model: varchar('model', { length: 80 }).notNull(),
    apiKey: text('api_key').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    userPromptTemplate: text('user_prompt_template').notNull().default(''),
    temperature: real('temperature').notNull().default(0.2),
    batchSize: integer('batch_size').notNull().default(10),
    isActive: boolean('is_active').notNull().default(false),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('ai_profiles_active_idx').on(t.isActive)],
);

export const aiScoringRuns = pgTable(
  'ai_scoring_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull().references(() => aiProfiles.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('running'),
    totalVideos: integer('total_videos').notNull().default(0),
    scoredVideos: integer('scored_videos').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(now),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('ai_runs_profile_idx').on(t.profileId, t.startedAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 60 }),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 64 }),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_actor_idx').on(t.actorId)],
);

export const userTagAffinity = pgTable(
  'user_tag_affinity',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    score: doublePrecision('score').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tagId] }), index('uta_user_score_idx').on(t.userId, t.score)],
);

export const userCategoryAffinity = pgTable(
  'user_category_affinity',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    score: doublePrecision('score').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] }), index('uca_user_score_idx').on(t.userId, t.score)],
);

export const recommendationImpressions = pgTable(
  'recommendation_impressions',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    count: integer('count').notNull().default(1),
    lastShownAt: timestamp('last_shown_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.videoId] }), index('rec_impressions_time_idx').on(t.userId, t.lastShownAt)],
);

export const analyticsSessions = pgTable(
  'analytics_sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    visitorId: varchar('visitor_id', { length: 64 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    client: varchar('client', { length: 10 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    country: varchar('country', { length: 60 }),
    region: varchar('region', { length: 60 }),
    city: varchar('city', { length: 60 }),
    deviceType: varchar('device_type', { length: 20 }),
    browser: varchar('browser', { length: 40 }),
    os: varchar('os', { length: 40 }),
    referrer: varchar('referrer', { length: 500 }),
    referrerHost: varchar('referrer_host', { length: 160 }),
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 120 }),
    landingPath: varchar('landing_path', { length: 500 }),
    isNewVisitor: boolean('is_new_visitor').notNull().default(true),
    pageviews: integer('pageviews').notNull().default(0),
    events: integer('events').notNull().default(0),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('an_sessions_started_idx').on(t.startedAt),
    index('an_sessions_visitor_idx').on(t.visitorId),
    index('an_sessions_lastseen_idx').on(t.lastSeenAt),
  ],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    visitorId: varchar('visitor_id', { length: 64 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: varchar('event', { length: 32 }).notNull(),
    path: varchar('path', { length: 500 }),
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'cascade' }),
    position: real('position'),
    duration: real('duration'),
    value: doublePrecision('value'),
    keyword: varchar('keyword', { length: 200 }),
    client: varchar('client', { length: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('an_events_created_idx').on(t.createdAt),
    index('an_events_type_time_idx').on(t.event, t.createdAt),
    index('an_events_video_idx').on(t.videoId, t.event),
    index('an_events_user_idx').on(t.userId, t.createdAt),
  ],
);

export const statsDaily = pgTable(
  'stats_daily',
  {
    date: varchar('date', { length: 10 }).primaryKey(),
    pageviews: integer('pageviews').notNull().default(0),
    uniqueVisitors: integer('unique_visitors').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    newUsers: integer('new_users').notNull().default(0),
    videoViews: integer('video_views').notNull().default(0),
    watchSeconds: bigint('watch_seconds', { mode: 'number' }).notNull().default(0),
    comments: integer('comments').notNull().default(0),
    revenueCents: integer('revenue_cents').notNull().default(0),
    newVips: integer('new_vips').notNull().default(0),
    bounceSessions: integer('bounce_sessions').notNull().default(0),
    totalSessionSeconds: bigint('total_session_seconds', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
);

export const statsVideoDaily = pgTable(
  'stats_video_daily',
  {
    date: varchar('date', { length: 10 }).notNull(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    plays: integer('plays').notNull().default(0),
    completes: integer('completes').notNull().default(0),
    watchSeconds: bigint('watch_seconds', { mode: 'number' }).notNull().default(0),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.date, t.videoId] }), index('stats_video_daily_video_idx').on(t.videoId)],
);

export const videoRetention = pgTable(
  'video_retention',
  {
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    bucket: integer('bucket').notNull(),
    viewers: integer('viewers').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.bucket] })],
);

export type AlgoWeightsRow = AlgoWeights;

export const videoCaptions = pgTable(
  'video_captions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
    lang: varchar('lang', { length: 16 }).notNull(),
    format: varchar('format', { length: 8 }).$type<CaptionFormat>().notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('video_captions_video_lang_uq').on(t.videoId, t.lang),
    index('video_captions_video_idx').on(t.videoId),
  ],
);

