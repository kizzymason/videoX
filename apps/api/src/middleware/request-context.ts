import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { AppError } from '../core/errors.js';
import { getRedis } from '../core/redis.js';

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.traceId = (typeof incoming === 'string' && incoming.slice(0, 64)) || randomUUID();
  res.setHeader('X-Request-Id', req.traceId);
  next();
};

/** 取真实客户端 IP。生产环境需配合 app.set('trust proxy', ...)。 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? '';
}

function keyByUserOrIp(req: Request): string {
  // 登录用户按 userId 限流，游客回落到 IP（用官方 helper 处理 IPv6 分段）。
  return req.auth?.id ?? ipKeyGenerator(req.ip ?? '');
}

/**
 * 计数放 Redis，不放进程内存。
 *
 * API 以 cluster 多进程跑，各进程独立计数会让实际额度变成 进程数 × limit，
 * 重启还会清零。Redis 挂掉时 passOnStoreError 让请求直接通过——限流失效
 * 比整站 500 好。
 */
function makeStore(prefix: string): Store {
  const redis = getRedis();
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as Promise<never>,
  });
}

function makeLimiter(options: {
  name: string;
  windowMs: number;
  limit: number;
  message: string;
  skipSuccess?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    skipSuccessfulRequests: options.skipSuccess ?? false,
    store: makeStore(options.name),
    passOnStoreError: true,
    handler: (_req, _res, next) => next(AppError.tooMany(options.message)),
  });
}

/** 全局兜底，防止单个客户端打满连接。 */
export const globalLimiter = makeLimiter({
  name: 'global',
  windowMs: 60_000,
  limit: 600,
  message: '请求过于频繁，请稍后再试',
});

/** 登录/注册：只统计失败次数，正常用户不受影响。 */
export const authLimiter = makeLimiter({
  name: 'auth',
  windowMs: 15 * 60_000,
  limit: 20,
  message: '尝试次数过多，请 15 分钟后再试',
  skipSuccess: true,
});

/** 兑换码：暴力枚举的主要目标，必须收紧。 */
export const redeemLimiter = makeLimiter({
  name: 'redeem',
  windowMs: 10 * 60_000,
  limit: 10,
  message: '兑换尝试过于频繁，请稍后再试',
});

/** 发评论 */
export const writeLimiter = makeLimiter({
  name: 'write',
  windowMs: 60_000,
  limit: 20,
  message: '操作太快了，休息一下',
});

/** 播放票据：正常播放一部片子不会超过这个量级。 */
export const playbackLimiter = makeLimiter({
  name: 'playback',
  windowMs: 60_000,
  limit: 120,
  message: '播放请求过于频繁',
});

/** 埋点上报：允许较高频率，但要防刷。 */
export const collectLimiter = makeLimiter({
  name: 'collect',
  windowMs: 60_000,
  limit: 300,
  message: '上报过于频繁',
});
