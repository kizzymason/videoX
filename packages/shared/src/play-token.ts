/**
 * HLS 防盗链令牌。
 *
 * 令牌形如 `v1.<payload>.<signature>`，payload 是 base64url 后的紧凑字段串。
 * 票签的是 `/hls/:videoId/*` 这一路，不是每个 .m4s/.ts。
 * master / playlist / 密钥仍要验这张票；分片复用同一张未过期的目录票。
 *
 * 该模块只能在 Node 环境使用（依赖 node:crypto），因此单独作为
 * `@videox/shared/play-token` 子路径导出，避免被浏览器构建拉进去。
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const PLAY_TOKEN_VERSION = 'v1';

export interface PlayTokenClaims {
  /** 视频 ID */
  videoId: string;
  /** 用户 ID，游客为 'anon' */
  userId: string;
  /** 过期时间戳（秒） */
  exp: number;
  /** 绑定的 IP 前缀，空串表示不绑定 */
  ipPrefix: string;
  /** UA 指纹（8 字节 hex） */
  uaHash: string;
  /** 随机数，保证同一秒签发的令牌互不相同 */
  nonce: string;
  /** 授权范围：full = 完整播放，preview = 仅试看片段 */
  scope: 'full' | 'preview';
  /** 目录通配，如 /hls/<videoId>/*，一张票覆盖该视频全部 HLS 路径 */
  path: string;
}

export type PlayTokenFailure =
  | 'malformed'
  | 'bad_version'
  | 'bad_signature'
  | 'expired'
  | 'video_mismatch'
  | 'ip_mismatch'
  | 'ua_mismatch'
  | 'path_mismatch';

export type PlayTokenVerification =
  | { ok: true; claims: PlayTokenClaims }
  | { ok: false; reason: PlayTokenFailure };

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * 取 IP 的前 N 段作为绑定依据。完整绑定 IP 会让移动网络切换基站时频繁失效，
 * 因此默认只绑定 IPv4 前三段 / IPv6 前四组。
 */
export function normalizeIpPrefix(ip: string | undefined | null, parts: number): string {
  if (!ip || parts <= 0) return '';
  const clean = ip.replace(/^::ffff:/i, '').trim();
  if (!clean) return '';
  if (clean.includes(':')) {
    return clean.split(':').slice(0, Math.max(1, Math.min(parts + 1, 8))).join(':');
  }
  return clean.split('.').slice(0, Math.max(1, Math.min(parts, 4))).join('.');
}

export function hashUserAgent(userAgent: string | undefined | null): string {
  return createHash('sha256')
    .update(userAgent ?? '')
    .digest('hex')
    .slice(0, 16);
}

/** 一张票覆盖该视频 HLS 目录下的 master / 分档列表 / 分片 / 密钥。 */
export function playTokenDirectory(videoId: string): string {
  return `/hls/${videoId}/*`;
}

/** tokenPath `/hls/id/*` 覆盖 `/hls/id` 及其子路径，不覆盖其它 videoId。 */
export function pathMatchesPlayToken(tokenPath: string, requestPath: string): boolean {
  if (!tokenPath || !requestPath) return false;
  if (tokenPath === requestPath) return true;
  if (tokenPath.endsWith('/*')) {
    const prefix = tokenPath.slice(0, -1);
    const dir = tokenPath.slice(0, -2);
    return requestPath === dir || requestPath.startsWith(prefix);
  }
  return false;
}

function serializeClaims(claims: PlayTokenClaims): string {
  return [
    claims.videoId,
    claims.userId,
    String(claims.exp),
    claims.ipPrefix,
    claims.uaHash,
    claims.nonce,
    claims.scope,
    claims.path,
  ].join('|');
}

function parseClaims(raw: string): PlayTokenClaims | null {
  const parts = raw.split('|');
  // 7 段是旧票（无 path），按 videoId 补目录，滚动发布时旧票仍能用。
  if (parts.length !== 7 && parts.length !== 8) return null;
  const [videoId, userId, exp, ipPrefix, uaHash, nonce, scope, pathPart] = parts;
  const expNum = Number(exp);
  if (!videoId || !userId || !Number.isFinite(expNum)) return null;
  if (scope !== 'full' && scope !== 'preview') return null;
  return {
    videoId,
    userId,
    exp: expNum,
    ipPrefix,
    uaHash,
    nonce,
    scope,
    path: pathPart || playTokenDirectory(videoId),
  };
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export interface SignPlayTokenInput {
  videoId: string;
  userId?: string | null;
  ttlSeconds: number;
  ip?: string | null;
  userAgent?: string | null;
  ipPrefixParts?: number;
  scope?: 'full' | 'preview';
  secret: string;
}

export interface SignedPlayToken {
  token: string;
  expiresAt: Date;
  ttlSeconds: number;
  claims: PlayTokenClaims;
}

export function signPlayToken(input: SignPlayTokenInput): SignedPlayToken {
  const ttlSeconds = Math.max(30, Math.floor(input.ttlSeconds));
  const claims: PlayTokenClaims = {
    videoId: input.videoId,
    userId: input.userId || 'anon',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    ipPrefix: normalizeIpPrefix(input.ip, input.ipPrefixParts ?? 3),
    uaHash: hashUserAgent(input.userAgent),
    nonce: randomBytes(6).toString('base64url'),
    scope: input.scope ?? 'full',
    path: playTokenDirectory(input.videoId),
  };
  const payload = b64urlEncode(serializeClaims(claims));
  const signature = sign(`${PLAY_TOKEN_VERSION}.${payload}`, input.secret);
  return {
    token: `${PLAY_TOKEN_VERSION}.${payload}.${signature}`,
    expiresAt: new Date(claims.exp * 1000),
    ttlSeconds,
    claims,
  };
}

export interface VerifyPlayTokenInput {
  token: string | undefined | null;
  secret: string;
  /** 传入则强制令牌里的 videoId 必须一致，防止拿 A 视频的票看 B 视频 */
  expectedVideoId?: string;
  ip?: string | null;
  userAgent?: string | null;
  ipPrefixParts?: number;
  /** 允许的时钟偏移（秒） */
  clockSkewSeconds?: number;
  /** 传入则令牌 path 必须覆盖该 HLS 路径（目录票） */
  expectedPath?: string;
}

export function verifyPlayToken(input: VerifyPlayTokenInput): PlayTokenVerification {
  const token = (input.token ?? '').trim();
  if (!token) return { ok: false, reason: 'malformed' };

  const segments = token.split('.');
  if (segments.length !== 3) return { ok: false, reason: 'malformed' };
  const [version, payload, signature] = segments;
  if (version !== PLAY_TOKEN_VERSION) return { ok: false, reason: 'bad_version' };

  const expected = sign(`${version}.${payload}`, input.secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: PlayTokenClaims | null;
  try {
    claims = parseClaims(b64urlDecode(payload));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims) return { ok: false, reason: 'malformed' };

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp + (input.clockSkewSeconds ?? 5) < now) {
    return { ok: false, reason: 'expired' };
  }
  if (input.expectedVideoId && claims.videoId !== input.expectedVideoId) {
    return { ok: false, reason: 'video_mismatch' };
  }
  if (claims.ipPrefix) {
    const current = normalizeIpPrefix(input.ip, input.ipPrefixParts ?? 3);
    if (current !== claims.ipPrefix) return { ok: false, reason: 'ip_mismatch' };
  }
  if (claims.uaHash && hashUserAgent(input.userAgent) !== claims.uaHash) {
    return { ok: false, reason: 'ua_mismatch' };
  }
  if (input.expectedPath && !pathMatchesPlayToken(claims.path, input.expectedPath)) {
    return { ok: false, reason: 'path_mismatch' };
  }

  return { ok: true, claims };
}

/** 剩余寿命占比，播放器据此决定何时静默续签。 */
export function playTokenRemainingRatio(claims: PlayTokenClaims, totalTtlSeconds: number): number {
  const remaining = claims.exp - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.min(1, remaining / Math.max(1, totalTtlSeconds)));
}

/**
 * 为单个视频派生 HLS AES-128 内容密钥。
 * 由主密钥 + videoId 派生，因此密钥不必落库，且不同视频互不影响。
 */
export function deriveHlsContentKey(videoId: string, masterSecret: string): Buffer {
  return createHmac('sha256', masterSecret).update(`hls-key:${videoId}`).digest().subarray(0, 16);
}

/** HLS IV 同样由 videoId 派生，保证与密钥配套。 */
export function deriveHlsIv(videoId: string, masterSecret: string): Buffer {
  return createHmac('sha256', masterSecret).update(`hls-iv:${videoId}`).digest().subarray(0, 16);
}
