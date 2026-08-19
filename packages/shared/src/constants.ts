/** 全站共享的枚举与常量。前后端唯一事实来源。 */

export const USER_ROLES = ['user', 'vip', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LEVEL: Record<UserRole, number> = {
  user: 0,
  vip: 1,
  admin: 100,
};

export const USER_STATUSES = ['active', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * 视频生命周期。`partially_ready` 是首屏加速的关键状态：
 * 最低画质档已就绪即可播放，其余档位仍在后台补齐。
 */
export const VIDEO_STATUSES = [
  'draft',
  'uploading',
  'queued',
  'transcoding',
  'partially_ready',
  'ready',
  'failed',
  'archived',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** 可以对外播放的状态集合。 */
export const PLAYABLE_VIDEO_STATUSES: readonly VideoStatus[] = ['partially_ready', 'ready'];

export const VIDEO_VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type VideoVisibility = (typeof VIDEO_VISIBILITIES)[number];

/** 观看门槛。点播只走会员；字段保留兼容旧数据，播放层不再认 free/login。 */
export const ACCESS_LEVELS = ['free', 'login', 'vip'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** 目录类型。点播与 Shorts 独立库存，后台上传时显式选择。 */
export const VIDEO_KINDS = ['vod', 'shorts'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/** 后台上传字幕只收这两种。 */
export const CAPTION_FORMATS = ['vtt', 'srt'] as const;
export type CaptionFormat = (typeof CAPTION_FORMATS)[number];

export const TRANSCODE_JOB_STATUSES = [
  'queued',
  'probing',
  'thumbnailing',
  'transcoding',
  'packaging',
  'completed',
  'failed',
  'canceled',
] as const;
export type TranscodeJobStatus = (typeof TRANSCODE_JOB_STATUSES)[number];

export const REDEEM_CODE_STATUSES = ['unused', 'used', 'disabled', 'expired'] as const;
export type RedeemCodeStatus = (typeof REDEEM_CODE_STATUSES)[number];

export const ORDER_STATUSES = ['pending', 'paid', 'canceled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ['redeem_code', 'manual_grant', 'payment'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'expired', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const COMMENT_STATUSES = ['visible', 'pending', 'hidden', 'deleted'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export const REACTION_TARGETS = ['video', 'comment'] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];

/** 埋点事件类型。analytics 聚合任务据此分流。 */
export const ANALYTICS_EVENTS = [
  'pageview',
  'video_impression',
  'video_click',
  'video_play',
  'video_progress',
  'video_complete',
  'video_error',
  'search',
  'signup',
  'login',
  'redeem',
  'heartbeat',
  /** 非会员撞上试看边界，用来衡量门禁转化 */
  'vip_gate',
  'share',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export const SORT_OPTIONS = [
  'recommended',
  'latest',
  'popular',
  'trending',
  'most_liked',
  'longest',
  'shortest',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

/** ABR 阶梯定义。绝不上采样：仅当源高度 >= height 才产出该档。 */
export interface RenditionSpec {
  name: string;
  height: number;
  /** 视频平均码率 kbps */
  videoBitrate: number;
  /** capped VBR 峰值 kbps */
  maxrate: number;
  /** VBV 缓冲 kbps */
  bufsize: number;
  audioBitrate: number;
}

export const RENDITION_LADDER: readonly RenditionSpec[] = [
  { name: '240p', height: 240, videoBitrate: 400, maxrate: 480, bufsize: 960, audioBitrate: 64 },
  { name: '360p', height: 360, videoBitrate: 800, maxrate: 960, bufsize: 1920, audioBitrate: 96 },
  { name: '480p', height: 480, videoBitrate: 1400, maxrate: 1680, bufsize: 3360, audioBitrate: 128 },
  { name: '720p', height: 720, videoBitrate: 2800, maxrate: 3360, bufsize: 6720, audioBitrate: 128 },
  { name: '1080p', height: 1080, videoBitrate: 5000, maxrate: 6000, bufsize: 12000, audioBitrate: 128 },
  { name: '1440p', height: 1440, videoBitrate: 9000, maxrate: 10800, bufsize: 21600, audioBitrate: 160 },
  { name: '2160p', height: 2160, videoBitrate: 16000, maxrate: 19200, bufsize: 38400, audioBitrate: 192 },
];

/** 首屏加速：这一档最先产出，产出后视频立刻进入 partially_ready 可播状态。 */
export const FAST_START_RENDITION = '360p';

/** HLS 分片时长（秒）。与 2 秒 GOP 对齐。 */
export const HLS_SEGMENT_SECONDS = 4;
export const HLS_GOP_SECONDS = 2;

/** 分片上传的单片大小：5MB。 */
export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;

/** 雪碧图规格：进度条悬停预览。 */
export const SPRITE_COLUMNS = 10;
export const SPRITE_TILE_WIDTH = 160;
export const SPRITE_INTERVAL_SECONDS = 10;
export const SPRITE_MAX_TILES = 300;

/** 点播已取消按秒试看；站点设置里的 previewSeconds 默认 0。 */
export const DEFAULT_PREVIEW_SECONDS = 0;

/** 媒体请求携带播放令牌的查询参数名。播放器续签时按这个键覆写 URL。 */
export const PLAY_TOKEN_PARAM = 'tk';

export const PAGE_SIZE_DEFAULT = 24;
export const PAGE_SIZE_MAX = 100;
