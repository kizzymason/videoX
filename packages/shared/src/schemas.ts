import { z } from 'zod';
import {
  ACCESS_LEVELS,
  ANALYTICS_EVENTS,
  COMMENT_STATUSES,
  ORDER_STATUSES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  REDEEM_CODE_STATUSES,
  SORT_OPTIONS,
  STORAGE_DRIVERS,
  USER_ROLES,
  USER_STATUSES,
  VIDEO_KINDS,
  VIDEO_STATUSES,
  VIDEO_VISIBILITIES,
} from './constants.js';

// --------------------------------------------------------------------------
// 通用
// --------------------------------------------------------------------------

export const idSchema = z.string().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
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
  /** vertical = Shorts，只出高大于宽；horizontal = 点播，排除竖屏。 */
  orientation: z.enum(['vertical', 'horizontal']).optional(),
  /** 后台 Shorts / 点播分栏：shorts→vertical，vod→horizontal。 */
  kind: z.enum(VIDEO_KINDS).optional(),
});

export const createVideoSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  description: z.string().max(5000).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('free'),
  visibility: z.enum(VIDEO_VISIBILITIES).default('public'),
  posterUrl: z.string().max(500).nullable().optional(),
  verticalPosterUrl: z.string().max(500).nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  /** 后台更新/创建时可标 Shorts 或点播；无 kind 列时只作分流提示。 */
  kind: z.enum(VIDEO_KINDS).optional(),
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
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  categoryId: idSchema.nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  accessLevel: z.enum(ACCESS_LEVELS).default('free'),
  visibility: z.enum(VIDEO_VISIBILITIES).default('public'),
  /** 后台上传：shorts 与点播分开；探测前写入占位宽高。 */
  kind: z.enum(VIDEO_KINDS).optional(),
});
