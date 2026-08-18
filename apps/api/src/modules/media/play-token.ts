import type { Request } from 'express';
import {
  signPlayToken,
  verifyPlayToken,
  type PlayTokenClaims,
  type PlayTokenFailure,
} from '@videox/shared/play-token';
import { env } from '../../config/env.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { getRedis } from '../../core/redis.js';
import { logger } from '../../core/logger.js';
import { clientIp } from '../../middleware/request-context.js';

const FAILURE_MESSAGES: Record<PlayTokenFailure, string> = {
  malformed: '播放凭证格式错误',
  bad_version: '播放凭证版本不受支持',
  bad_signature: '播放凭证签名校验失败',
  expired: '播放凭证已过期，请刷新页面',
  video_mismatch: '播放凭证与目标视频不匹配',
  ip_mismatch: '网络环境已变化，请刷新页面重新获取播放凭证',
  ua_mismatch: '播放凭证与当前浏览器不匹配',
};

import { PLAY_TOKEN_PARAM } from '@videox/shared';

export { PLAY_TOKEN_PARAM };

export function issuePlayToken(params: {
  req: Request;
  videoId: string;
  userId: string | null;
  scope?: 'full' | 'preview';
  ttlSeconds?: number;
}) {
  return signPlayToken({
    videoId: params.videoId,
    userId: params.userId,
    ttlSeconds: params.ttlSeconds ?? env.PLAY_TOKEN_TTL_SECONDS,
    ip: clientIp(params.req),
    userAgent: String(params.req.headers['user-agent'] ?? ''),
    ipPrefixParts: env.PLAY_TOKEN_IP_PREFIX_PARTS,
    scope: params.scope ?? 'full',
    secret: env.PLAY_TOKEN_SECRET,
  });
}

/**
 * 硬校验。任何一个 manifest / 分片 / 密钥请求都会走这里，
 * 校验失败一律 403，不泄露具体资源是否存在。
 */
export function requirePlayToken(req: Request, expectedVideoId: string): PlayTokenClaims {
  const token =
    (typeof req.query[PLAY_TOKEN_PARAM] === 'string' ? (req.query[PLAY_TOKEN_PARAM] as string) : null) ??
    (typeof req.headers['x-play-token'] === 'string' ? req.headers['x-play-token'] : null);

  const result = verifyPlayToken({
    token,
    secret: env.PLAY_TOKEN_SECRET,
    expectedVideoId,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
    ipPrefixParts: env.PLAY_TOKEN_IP_PREFIX_PARTS,
  });

  if (!result.ok) {
    logger.debug({ reason: result.reason, videoId: expectedVideoId }, '播放凭证校验失败');
    throw new AppError({
      message: FAILURE_MESSAGES[result.reason],
      code: ErrorCode.PLAY_TOKEN_INVALID,
      status: 403,
    });
  }

  return result.claims;
}

// --------------------------------------------------------------------------
// 并发观看数限制
// --------------------------------------------------------------------------

const STREAM_TTL_SECONDS = 90;

function streamKey(userId: string): string {
  return `streams:${userId}`;
}

/**
 * 用 Redis 有序集合记录「用户 → 活跃播放会话」，score 为最后心跳时间。
 * 每次请求 manifest 时续期；超过上限则拒绝新会话，但已在列表内的会话不受影响。
 */
export async function registerStream(userId: string, sessionKey: string, limit: number): Promise<void> {
  if (userId === 'anon') return;

  const redis = getRedis();
  const key = streamKey(userId);
  const now = Date.now();

  try {
    await redis.zremrangebyscore(key, 0, now - STREAM_TTL_SECONDS * 1000);
    const isExisting = (await redis.zscore(key, sessionKey)) !== null;

    if (!isExisting) {
      const active = await redis.zcard(key);
      if (active >= limit) {
        throw new AppError({
          message: `同时在线播放已达上限（${limit} 台设备），请关闭其它设备后重试`,
          code: ErrorCode.CONCURRENT_STREAM_LIMIT,
          status: 429,
        });
      }
    }

    await redis.zadd(key, now, sessionKey);
    await redis.expire(key, STREAM_TTL_SECONDS * 2);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Redis 故障不应该让所有人看不了视频，降级放行。
    logger.warn({ err: error }, '并发播放计数失败，已降级放行');
  }
}

export async function releaseStream(userId: string, sessionKey: string): Promise<void> {
  if (userId === 'anon') return;
  try {
    await getRedis().zrem(streamKey(userId), sessionKey);
  } catch {
    // 忽略：TTL 会自动清理。
  }
}

/** 会话标识：同一浏览器同一视频算一路流，换标签页看别的片子算另一路。 */
export function streamSessionKey(claims: PlayTokenClaims): string {
  return `${claims.videoId}:${claims.uaHash}:${claims.ipPrefix}`;
}
