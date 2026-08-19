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
  VideoKind,
  VideoStatus,
  VideoVisibility,
} from '@videox/shared';

const now = sql`now()`;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
};

// ==========================================================================
// 用户与认证
// ==========================================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 160 }),
    /** 小写化的邮箱，唯一索引建在它上面；未填邮箱时为 null，允许多个空值 */
    emailNormalized: varchar('email_normalized', { length: 160 }),
    username: varchar('username', { length: 32 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    bio: text('bio'),
    role: varchar('role', { length: 16 }).$type<UserRole>().notNull().default('user'),
    status: varchar('status', { length: 16 }).$type<UserStatus>().notNull().default('active'),
    /** 会员到期时间。null 或过期即非会员，是播放门禁的唯一判据。 */
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
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 只存 SHA-256 摘要，明文仅存在于 httpOnly cookie 中 */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** 轮换链：被替换后指向新令牌，用于检测重放 */
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

// ==========================================================================
// 分类 / 标签
// ==========================================================================

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

// ==========================================================================
// 视频
// ==========================================================================

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
    accessLevel: varchar('access_level', { length: 16 }).$type<AccessLevel>().notNull().default('free'),

    /** 存储层相对路径，例如 videos/<id>/source.mp4 */
    sourceKey: varchar('source_key', { length: 500 }),
    sourceSizeBytes: bigint('source_size_bytes', { mode: 'number' }),
    /** 整文件 SHA-256，用于秒传去重 */
    sourceHash: varchar('source_hash', { length: 64 }),
    /** HLS 输出目录，例如 hls/<id> */
    hlsDir: varchar('hls_dir', { length: 500 }),
    posterUrl: varchar('poster_url', { length: 500 }),
    verticalPosterUrl: varchar('vertical_poster_url', { length: 500 }),
    previewUrl: varchar('preview_url', { length: 500 }),
    spriteUrl: varchar('sprite_url', { length: 500 }),
    spriteVttUrl: varchar('sprite_vtt_url', { length: 500 }),

    durationSeconds: integer('duration_seconds').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    /** vod | shorts。后台上传时写入；存量竖屏在迁移里回填为 shorts。 */
    kind: varchar('kind', { length: 16 }).$type<VideoKind>().notNull().default('vod'),
    fps: real('fps'),
    /** 各画质档产出状态。首档就绪即可播放。 */
    renditions: jsonb('renditions').$type<RenditionRecord[]>().notNull().default(sql`'[]'::jsonb`),
    isEncrypted: boolean('is_encrypted').notNull().default(false),
    outputBytes: bigint('output_bytes', { mode: 'number' }).notNull().default(0),

    viewCount: integer('view_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    shareCount: integer('share_count').notNull().default(0),
    /** 累计观看秒数，用于计算平均完播率 */
    totalWatchSeconds: bigint('total_watch_seconds', { mode: 'number' }).notNull().default(0),
    /** 0~1 的平均完播率，推荐打分的核心因子 */
    completionRate: doublePrecision('completion_rate').notNull().default(0),
    /** 质量分：由互动率归一化得到 */
    qualityScore: doublePrecision('quality_score').notNull().default(0),
    /** AI 重排写入的 0~100 分 */
    aiScore: doublePrecision('ai_score'),
    aiReason: text('ai_reason'),
    aiScoredAt: timestamp('ai_scored_at', { withTimezone: true }),
    /** 人工加权，正负均可，直接叠加到最终排序分 */
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
