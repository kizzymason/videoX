import { z } from 'zod';
import {
  ACCESS_LEVELS,
  ANALYTICS_EVENTS,
  COMMENT_STATUSES,
  VIDEO_KINDS,
  ORDER_STATUSES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  REDEEM_CODE_STATUSES,
  SORT_OPTIONS,
  STORAGE_DRIVERS,
  USER_ROLES,
  USER_STATUSES,
  VIDEO_STATUSES,
  VIDEO_VISIBILITIES,
} from './constants.js';
import { normalizeRedeemInput, REDEEM_CODE_PREFIX_MAX } from './redeem-code.js';

// --------------------------------------------------------------------------
// 通用
// --------------------------------------------------------------------------

export const idSchema = z.string().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

/** 后台批量勾选删除：用户、卡密等共用。 */
export const bulkIdsSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
});

export const cursorSchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

// --------------------------------------------------------------------------
// 认证
// --------------------------------------------------------------------------

const usernameSchema = z
  .string()
  .min(3, '用户名至少 3 个字符')
  .max(24, '用户名最多 24 个字符')
  .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/, '用户名只能包含字母、数字、下划线、连字符或中文');

const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(128, '密码最多 128 位')
  .regex(/[a-zA-Z]/, '密码需包含字母')
  .regex(/[0-9]/, '密码需包含数字');

export const registerSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value),
    z.string().email('邮箱格式不正确').max(160).optional(),
  ),
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(32).optional(),
});

export const loginSchema = z.object({
  /** 支持邮箱或用户名登录 */
  identifier: z.string().min(3).max(160),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional().default(true),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(32).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});

// --------------------------------------------------------------------------
// 视频
// --------------------------------------------------------------------------

export const videoListQuerySchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  categoryId: idSchema.optional(),
  categorySlug: z.string().max(80).optional(),
  tag: z.string().max(80).optional(),
  authorId: idSchema.optional(),
  accessLevel: z.enum(ACCESS_LEVELS).optional(),
  status: z.enum(VIDEO_STATUSES).optional(),
  visibility: z.enum(VIDEO_VISIBILITIES).optional(),
  sort: z.enum(SORT_OPTIONS).default('latest'),
  minDuration: z.coerce.number().int().min(0).optional(),
  maxDuration: z.coerce.number().int().min(0).optional(),
  /** 兼容旧客户端；列表不再按宽高过滤，播放器横竖都支持。 */
  orientation: z.enum(['vertical', 'horizontal']).optional(),
  /** 后台目录拆分：shorts 与 vod 独立库存。 */
  kind: z.enum(VIDEO_KINDS).optional(),
});

export const createVideoSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(5000),
  description: z.string().max(5000).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('vip'),
  visibility: z.enum(VIDEO_VISIBILITIES).default('public'),
  kind: z.enum(VIDEO_KINDS).optional(),
  posterUrl: z.string().max(500).nullable().optional(),
  verticalPosterUrl: z.string().max(500).nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
});

export const updateVideoSchema = createVideoSchema.partial();

export const bulkVideoActionSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
  action: z.enum(['publish', 'unpublish', 'archive', 'delete', 'retranscode', 'set_access', 'set_category']),
  accessLevel: z.enum(ACCESS_LEVELS).optional(),
  categoryId: idSchema.nullable().optional(),
});

// --------------------------------------------------------------------------
// 上传
// --------------------------------------------------------------------------

export const uploadInitSchema = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.coerce.number().int().min(1).max(50 * 1024 * 1024 * 1024),
  chunkSize: z.coerce.number().int().min(256 * 1024).max(64 * 1024 * 1024),
  /** 整文件 SHA-256，用于秒传去重 */
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  mimeType: z.string().max(120).optional(),
});

export const uploadCompleteSchema = z.object({
  title: z.string().min(1).max(5000).optional(),
  description: z.string().max(5000).optional(),
  categoryId: idSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('vip'),
  visibility: z.enum(VIDEO_VISIBILITIES).default('public'),
  /** 后台上传 Shorts 与点播分开；默认点播。 */
  kind: z.enum(VIDEO_KINDS).default('vod'),
});

// --------------------------------------------------------------------------
// 互动
// --------------------------------------------------------------------------

export const createCommentSchema = z.object({
  videoId: idSchema,
  content: z.string().min(1, '评论不能为空').max(2000),
  parentId: idSchema.nullable().optional(),
});

export const commentListQuerySchema = paginationSchema.extend({
  videoId: idSchema.optional(),
  parentId: idSchema.optional(),
  status: z.enum(COMMENT_STATUSES).optional(),
  sort: z.enum(['newest', 'oldest', 'hottest']).default('hottest'),
  q: z.string().max(120).optional(),
});

export const progressSchema = z.object({
  videoId: idSchema,
  positionSeconds: z.coerce.number().min(0).max(24 * 3600),
  durationSeconds: z.coerce.number().min(0).max(24 * 3600).optional(),
  /** 本次心跳实际观看时长，用于统计总播放时长 */
  deltaSeconds: z.coerce.number().min(0).max(600).optional(),
});

// --------------------------------------------------------------------------
// 会员
// --------------------------------------------------------------------------

export const redeemSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(64)
    .transform((v) => normalizeRedeemInput(v))
    .refine((v) => /^[A-Z0-9-]+$/.test(v), '订阅码只能是字母、数字'),
});

export const planSchema = z.object({
  code: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i, '套餐编码只能包含字母数字和 -_'),
  name: z.string().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  durationDays: z.coerce.number().int().min(1).max(36500),
  priceCents: z.coerce.number().int().min(0),
  originalPriceCents: z.coerce.number().int().min(0).nullable().optional(),
  perks: z.array(z.string().max(80)).max(12).default([]),
  badge: z.string().max(20).nullable().optional(),
  isRecommended: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const generateCodesSchema = z.object({
  planId: idSchema,
  count: z.coerce.number().int().min(1).max(5000),
  prefix: z
    .string()
    .max(REDEEM_CODE_PREFIX_MAX)
    .regex(/^[A-Z0-9]*$/i, '前缀只能是大写字母和数字')
    .transform((v) => v.toUpperCase())
    .optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().max(200).optional(),
});

export const redeemCodeQuerySchema = paginationSchema.extend({
  status: z.enum(REDEEM_CODE_STATUSES).optional(),
  planId: idSchema.optional(),
  batchId: z.string().max(64).optional(),
  q: z.string().max(64).optional(),
});

export const grantVipSchema = z.object({
  userId: idSchema,
  days: z.coerce.number().int().min(1).max(36500),
  note: z.string().max(200).optional(),
});

// --------------------------------------------------------------------------
// 播放
// --------------------------------------------------------------------------

export const playTicketSchema = z.object({
  videoId: idSchema,
});

export const uploadCaptionSchema = z.object({
  lang: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z]{2})?$/, '语言代码不正确'),
  filename: z.string().min(1).max(255),
  content: z.string().min(1, '字幕文件不能为空').max(2_000_000),
});


// --------------------------------------------------------------------------
// 后台配置
// --------------------------------------------------------------------------

export const s3ConfigSchema = z.object({
  endpoint: z.string().max(300).default(''),
  region: z.string().max(60).default('auto'),
  bucket: z.string().max(120).default(''),
  accessKeyId: z.string().max(200).default(''),
  secretAccessKey: z.string().max(300).default(''),
  forcePathStyle: z.boolean().default(true),
  publicBaseUrl: z.string().max(300).default(''),
});

export const storageProfileSchema = z.object({
  name: z.string().min(1).max(60),
  driver: z.enum(STORAGE_DRIVERS),
  isActive: z.boolean().default(false),
  config: s3ConfigSchema.partial().extend({ root: z.string().max(300).optional() }).default({}),
});

export const siteSettingsSchema = z.object({
  siteName: z.string().min(1).max(60),
  siteTagline: z.string().max(120).default(''),
  siteDescription: z.string().max(300).default(''),
  siteKeywords: z.string().max(300).default(''),
  logoUrl: z.string().max(500).nullable().default(null),
  faviconUrl: z.string().max(500).nullable().default(null),
  defaultTheme: z.enum(['light', 'dark', 'system']).default('light'),
  icpBeian: z.string().max(120).nullable().default(null),
  footerText: z.string().max(300).nullable().default(null),
  contactEmail: z.string().max(160).nullable().default(null),
  allowRegistration: z.boolean().default(true),
  commentsRequireApproval: z.boolean().default(false),
  /** 点播不再按秒试看，保留字段以免旧后台配置校验失败。 */
  previewSeconds: z.coerce.number().int().min(0).max(3600).default(0),
  /** 游客与非会员可完整看的 Shorts 条数。 */
  shortsFreeCount: z.coerce.number().int().min(0).max(50).default(3),
  maxConcurrentStreams: z.coerce.number().int().min(1).max(50).default(3),
  seo: z
    .object({
      videoTitleTemplate: z.string().max(200).default('{title} - {siteName}'),
      categoryTitleTemplate: z.string().max(200).default('{category} - {siteName}'),
      sitemapEnabled: z.boolean().default(true),
      sitemapPageSize: z.coerce.number().int().min(100).max(50000).default(5000),
      robotsExtra: z.string().max(2000).default(''),
    })
    // prefault 而非 default：让空对象走一遍字段级默认值，而不是要求给全整个对象。
    .prefault({}),
});

export const aiProfileSchema = z.object({
  name: z.string().min(1).max(60),
  endpoint: z.string().min(1).max(300),
  model: z.string().min(1).max(80),
  apiKey: z.string().max(300).default(''),
  systemPrompt: z.string().max(4000).default(''),
  userPromptTemplate: z.string().max(4000).default(''),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  batchSize: z.coerce.number().int().min(1).max(50).default(10),
  isActive: z.boolean().default(false),
});

export const algoWeightsSchema = z.object({
  affinity: z.coerce.number().min(0).max(10).default(1.0),
  quality: z.coerce.number().min(0).max(10).default(0.8),
  freshness: z.coerce.number().min(0).max(10).default(0.6),
  completion: z.coerce.number().min(0).max(10).default(0.9),
  popularity: z.coerce.number().min(0).max(10).default(0.5),
  aiScore: z.coerce.number().min(0).max(10).default(0.7),
  affinityHalfLifeDays: z.coerce.number().min(1).max(365).default(14),
  freshnessHalfLifeDays: z.coerce.number().min(1).max(365).default(7),
  diversityLambda: z.coerce.number().min(0).max(1).default(0.25),
  maxPerAuthor: z.coerce.number().int().min(1).max(50).default(3),
  maxPerCategory: z.coerce.number().int().min(1).max(50).default(6),
  explorationRatio: z.coerce.number().min(0).max(0.9).default(0.15),
});

export const bannerSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).nullable().optional(),
  imageUrl: z.string().min(1).max(500),
  mobileImageUrl: z.string().max(500).nullable().optional(),
  linkUrl: z.string().max(500).nullable().optional(),
  videoId: idSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

export const categorySchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, '别名只能包含小写字母、数字和连字符'),
  name: z.string().min(1).max(60),
  description: z.string().max(500).nullable().optional(),
  coverUrl: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  parentId: idSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const userAdminQuerySchema = paginationSchema.extend({
  q: z.string().max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  vipOnly: z.coerce.boolean().optional(),
});

export const updateUserAdminSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  displayName: z.string().min(1).max(32).optional(),
  bio: z.string().max(500).nullable().optional(),
});

export const orderQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().max(120).optional(),
});

// --------------------------------------------------------------------------
// 统计
// --------------------------------------------------------------------------

export const analyticsPayloadSchema = z.object({
  event: z.enum(ANALYTICS_EVENTS),
  sessionId: z.string().min(1).max(64),
  visitorId: z.string().min(1).max(64),
  path: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  videoId: idSchema.optional(),
  position: z.coerce.number().min(0).optional(),
  duration: z.coerce.number().min(0).optional(),
  value: z.coerce.number().optional(),
  keyword: z.string().max(200).optional(),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
  screen: z.object({ w: z.coerce.number().int(), h: z.coerce.number().int() }).optional(),
  client: z.enum(['pc', 'mobile', 'admin']),
  ts: z.coerce.number().int(),
});

export const analyticsBatchSchema = z.object({
  events: z.array(analyticsPayloadSchema).min(1).max(50),
});

export const rangeQuerySchema = z.object({
  /** 统计窗口天数 */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VideoListQuery = z.infer<typeof videoListQuerySchema>;
export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type UploadInitInput = z.infer<typeof uploadInitSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type GenerateCodesInput = z.infer<typeof generateCodesSchema>;
export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;
export type AlgoWeightsInput = z.infer<typeof algoWeightsSchema>;
export type AiProfileInput = z.infer<typeof aiProfileSchema>;
