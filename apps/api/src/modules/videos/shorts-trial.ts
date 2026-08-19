import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { getRedis } from '../../core/redis.js';

const COOKIE = 'vx_st';
const COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_STORED_IDS = 64;

function redisKey(userId: string): string {
  return `shorts-trial:${userId}`;
}

function parseCookieIds(req: Request): string[] {
  const raw = req.signedCookies?.[COOKIE];
  if (typeof raw !== 'string' || !raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .slice(0, MAX_STORED_IDS);
}

async function readRedisIds(userId: string): Promise<string[] | null> {
  try {
    const members = await getRedis().smembers(redisKey(userId));
    return members.slice(0, MAX_STORED_IDS);
  } catch (err) {
    logger.warn({ err, userId }, 'shorts trial redis read failed');
    return null;
  }
}

export async function loadShortsTrialIds(req: Request, userId?: string): Promise<string[]> {
  const cookieIds = parseCookieIds(req);
  if (!userId) return cookieIds;

  const redisIds = await readRedisIds(userId);
  if (!redisIds) return cookieIds;

  return [...new Set([...redisIds, ...cookieIds])].slice(0, MAX_STORED_IDS);
}

export async function persistShortsTrialIds(
  res: Response,
  ids: string[],
  userId?: string,
): Promise<void> {
  const unique = [...new Set(ids)].slice(0, MAX_STORED_IDS);
  res.cookie(COOKIE, unique.join(','), {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });

  if (!userId) return;
  try {
    const redis = getRedis();
    const key = redisKey(userId);
    await redis.del(key);
    if (unique.length === 0) return;
    await redis.sadd(key, ...unique);
    await redis.expire(key, Math.floor(COOKIE_MAX_AGE_MS / 1000));
  } catch (err) {
    logger.warn({ err, userId }, 'shorts trial redis write failed');
  }
}
