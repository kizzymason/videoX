import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import { ROLE_LEVEL, type UserRole } from '@videox/shared';
import { db, t } from '../core/db.js';
import { AppError, ErrorCode } from '../core/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export interface AuthContext {
  id: string;
  role: UserRole;
  vipExpiresAt: Date | null;
  isVip: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // HLS 分片请求走 <video> 标签发起，带不上自定义 header，允许 query 传递。
  const q = req.query?.access_token;
  if (typeof q === 'string' && q) return q;
  return null;
}

function toContext(payload: { sub: string; role: UserRole; vipExp: number | null }): AuthContext {
  const vipExpiresAt = payload.vipExp ? new Date(payload.vipExp * 1000) : null;
  return {
    id: payload.sub,
    role: payload.role,
    vipExpiresAt,
    isVip: payload.role === 'admin' || (vipExpiresAt !== null && vipExpiresAt.getTime() > Date.now()),
  };
}

/** 解析令牌但不强制登录。用于既支持游客又支持登录态的接口。 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next();
  const payload = verifyAccessToken(token);
  if (payload) req.auth = toContext(payload);
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next(AppError.unauthorized('请先登录'));
  const payload = verifyAccessToken(token);
  if (!payload) return next(AppError.unauthorized('登录状态已失效，请重新登录', ErrorCode.TOKEN_EXPIRED));
  req.auth = toContext(payload);
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  const minLevel = Math.min(...roles.map((r) => ROLE_LEVEL[r]));
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthorized('请先登录'));
    if (ROLE_LEVEL[req.auth.role] < minLevel) return next(AppError.forbidden('没有操作权限'));
    next();
  };
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(AppError.unauthorized('请先登录'));
  if (req.auth.role !== 'admin') return next(AppError.forbidden('需要管理员权限'));
  next();
};

/**
 * 会员硬校验：不信任 access token 里的 vipExp 快照，回源数据库确认。
 * 只在真正涉及付费内容的入口调用（播放票据、加密密钥）。
 */
export async function assertVipFresh(req: Request): Promise<boolean> {
  if (!req.auth) return false;
  if (req.auth.role === 'admin') return true;

  const [user] = await db
    .select({ vipExpiresAt: t.users.vipExpiresAt, status: t.users.status })
    .from(t.users)
    .where(eq(t.users.id, req.auth.id))
    .limit(1);

  if (!user || user.status === 'banned') return false;
  const fresh = user.vipExpiresAt !== null && user.vipExpiresAt.getTime() > Date.now();
  req.auth.vipExpiresAt = user.vipExpiresAt;
  req.auth.isVip = fresh;
  return fresh;
}

/** 封禁检查。挂在需要写操作的路由上，避免被封用户继续发内容。 */
export async function assertNotBanned(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) return next(AppError.unauthorized('请先登录'));
  const [user] = await db
    .select({ status: t.users.status })
    .from(t.users)
    .where(eq(t.users.id, req.auth.id))
    .limit(1);
  if (!user) return next(AppError.unauthorized('账号不存在'));
  if (user.status === 'banned') {
    return next(AppError.forbidden('账号已被封禁', ErrorCode.ACCOUNT_BANNED));
  }
  next();
}
