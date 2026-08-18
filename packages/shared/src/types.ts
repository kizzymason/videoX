import type {
  AccessLevel,
  AnalyticsEvent,
  CommentStatus,
  OrderSource,
  OrderStatus,
  RedeemCodeStatus,
  StorageDriver,
  SubscriptionStatus,
  TranscodeJobStatus,
  UserRole,
  UserStatus,
  VideoStatus,
  VideoVisibility,
} from './constants.js';

/** 统一响应包裹。所有 API 返回都是这个形状。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  traceId: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// --------------------------------------------------------------------------
// 用户与会员
// --------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  createdAt: string;
}

export interface CurrentUser extends PublicUser {
  email: string;
  role: UserRole;
  status: UserStatus;
  isVip: boolean;
  vipExpiresAt: string | null;
  lastLoginAt: string | null;
}

export interface AuthSession {
  user: CurrentUser;
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface MembershipPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  durationDays: number;
  priceCents: number;
  originalPriceCents: number | null;
  /** 卖点列表，展示在套餐卡片上 */
  perks: string[];
  badge: string | null;
  isRecommended: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string | null;
  planName: string | null;
  status: SubscriptionStatus;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface RedeemCode {
  id: string;
  code: string;
  planId: string;
  planName: string;
  batchId: string | null;
  status: RedeemCodeStatus;
  usedByUserId: string | null;
  usedByUsername: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface RedeemResult {
  planName: string;
  durationDays: number;
  /** 兑换后的会员到期时间（已顺延） */
  vipExpiresAt: string;
  extended: boolean;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  username: string;
  planId: string | null;
  planName: string | null;
  amountCents: number;
  source: OrderSource;
  status: OrderStatus;
  redeemCodeId: string | null;
  createdAt: string;
}

// --------------------------------------------------------------------------
// 内容
// --------------------------------------------------------------------------

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  videoCount: number;
}

export interface Tag {
  id: string;
  slug: string;
  name: string;
  videoCount: number;
}

export interface VideoRendition {
  name: string;
  height: number;
  width: number;
  bandwidth: number;
  ready: boolean;
}

export interface VideoSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  posterUrl: string | null;
  /** 竖版封面，移动端瀑布流优先使用 */
  verticalPosterUrl: string | null;
  previewUrl: string | null;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  status: VideoStatus;
  visibility: VideoVisibility;
  accessLevel: AccessLevel;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  publishedAt: string | null;
  createdAt: string;
  category: Pick<Category, 'id' | 'slug' | 'name'> | null;
  tags: Pick<Tag, 'id' | 'slug' | 'name'>[];
  author: Pick<PublicUser, 'id' | 'username' | 'displayName' | 'avatarUrl'> | null;
  /** 推荐引擎回填，仅在推荐流里出现 */
  recommendReason?: string | null;
}

export interface VideoDetail extends VideoSummary {
  renditions: VideoRendition[];
  spriteUrl: string | null;
  spriteVttUrl: string | null;
  isEncrypted: boolean;
  previewSeconds: number;
  /** 当前用户的互动状态 */
  viewer: {
    liked: boolean;
    favorited: boolean;
    following: boolean;
    canPlay: boolean;
    /** canPlay 为 false 时给出原因：login_required | vip_required | unavailable */
    gateReason: 'login_required' | 'vip_required' | 'unavailable' | null;
    resumeSeconds: number;
  };
}

export interface PlaybackTicket {
  videoId: string;
  /** 已带签名参数的 master.m3u8 完整地址 */
  masterUrl: string;
  token: string;
  expiresAt: string;
  /** 剩余有效秒数，播放器据此安排续签 */
  ttlSeconds: number;
  isEncrypted: boolean;
  previewSeconds: number | null;
  resumeSeconds: number;
  spriteVttUrl: string | null;
  renditions: VideoRendition[];
}

export interface Comment {
  id: string;
  videoId: string;
  parentId: string | null;
  rootId: string | null;
  content: string;
  status: CommentStatus;
  likeCount: number;
  replyCount: number;
  pinned: boolean;
  createdAt: string;
  author: Pick<PublicUser, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
  /** 回复某人时展示 @对方 */
  replyToUser: Pick<PublicUser, 'id' | 'username' | 'displayName'> | null;
  liked: boolean;
  /** 楼中楼：前 N 条预览回复 */
  replies?: Comment[];
}

export interface WatchHistoryItem {
  id: string;
  video: VideoSummary;
  positionSeconds: number;
  durationSeconds: number;
  percent: number;
  watchedAt: string;
}

export interface FavoriteItem {
  id: string;
  video: VideoSummary;
  createdAt: string;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string | null;
  videoId: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

// --------------------------------------------------------------------------
// 上传与转码
// --------------------------------------------------------------------------

export interface UploadSession {
  id: string;
  filename: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  status: 'pending' | 'uploading' | 'completed' | 'aborted';
  videoId: string | null;
  /** 命中秒传时为 true，无需再上传任何分片 */
  instant: boolean;
  createdAt: string;
}

export interface TranscodeJob {
  id: string;
  videoId: string;
  videoTitle: string;
  status: TranscodeJobStatus;
  progress: number;
  stage: string | null;
  currentRendition: string | null;
  completedRenditions: string[];
  errorMessage: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// --------------------------------------------------------------------------
// 配置
// --------------------------------------------------------------------------

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  /** 读取时后端会脱敏成 `****`，保存空串表示不修改 */
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

export interface StorageProfile {
  id: string;
  name: string;
  driver: StorageDriver;
  isActive: boolean;
  config: Partial<S3Config> & { root?: string };
  createdAt: string;
}

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  siteKeywords: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  defaultTheme: 'light' | 'dark' | 'system';
  icpBeian: string | null;
  footerText: string | null;
  contactEmail: string | null;
  allowRegistration: boolean;
  commentsRequireApproval: boolean;
  previewSeconds: number;
  maxConcurrentStreams: number;
  seo: {
    videoTitleTemplate: string;
    categoryTitleTemplate: string;
    sitemapEnabled: boolean;
    sitemapPageSize: number;
    robotsExtra: string;
  };
}

export interface AiProfile {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  /** 读取时脱敏 */
  apiKey: string;
  systemPrompt: string;
  userPromptTemplate: string;
  temperature: number;
  batchSize: number;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface AiScoringRun {
  id: string;
  profileId: string;
  profileName: string;
  status: 'running' | 'completed' | 'failed';
  totalVideos: number;
  scoredVideos: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 推荐算法权重。全部可在后台调参。 */
export interface AlgoWeights {
  affinity: number;
  quality: number;
  freshness: number;
  completion: number;
  popularity: number;
  aiScore: number;
  /** 半衰期（天），控制用户兴趣的时间衰减速度 */
  affinityHalfLifeDays: number;
  /** 新鲜度半衰期（天） */
  freshnessHalfLifeDays: number;
  /** MMR 多样性系数：0 = 只看相关性，1 = 只看多样性 */
  diversityLambda: number;
  /** 同一作者在一屏中最多出现次数 */
  maxPerAuthor: number;
  /** 同一分类在一屏中最多出现次数 */
  maxPerCategory: number;
  /** 探索比例：随机注入的新内容占比 */
  explorationRatio: number;
}

// --------------------------------------------------------------------------
// 统计
// --------------------------------------------------------------------------

export interface AnalyticsPayload {
  event: AnalyticsEvent;
  sessionId: string;
  visitorId: string;
  path?: string;
  referrer?: string;
  videoId?: string;
  /** video_progress 用：当前播放秒数 */
  position?: number;
  duration?: number;
  value?: number;
  keyword?: string;
  utm?: Record<string, string>;
  screen?: { w: number; h: number };
  client: 'pc' | 'mobile' | 'admin';
  ts: number;
}

export interface DashboardOverview {
  totals: {
    users: number;
    videos: number;
    views: number;
    comments: number;
    vipUsers: number;
    revenueCents: number;
    storageBytes: number;
    watchSeconds: number;
  };
  deltas: {
    users: number;
    views: number;
    revenueCents: number;
    watchSeconds: number;
  };
  realtime: {
    onlineUsers: number;
    playingNow: number;
    last30MinViews: number;
  };
}

export interface TrendPoint {
  date: string;
  pageviews: number;
  uniqueVisitors: number;
  newUsers: number;
  videoViews: number;
  watchSeconds: number;
  revenueCents: number;
}

export interface BreakdownItem {
  label: string;
  value: number;
  percent: number;
}

export interface VisitorInsights {
  trend: TrendPoint[];
  devices: BreakdownItem[];
  browsers: BreakdownItem[];
  os: BreakdownItem[];
  countries: BreakdownItem[];
  referrers: BreakdownItem[];
  utmSources: BreakdownItem[];
  topPaths: BreakdownItem[];
  topKeywords: BreakdownItem[];
  newVsReturning: { newVisitors: number; returning: number };
  avgSessionSeconds: number;
  bounceRate: number;
}

export interface VideoRetentionPoint {
  bucket: number;
  percentOfViewers: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}
