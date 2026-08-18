import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { UserRole } from '@videox/shared';
import { env } from '../../config/env.js';

export const REFRESH_COOKIE = 'videox_rt';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  /** 会员到期时间戳（秒）。放进令牌可以让大部分请求免去一次 DB 查询， */
  /** 但涉及付费内容的硬校验仍然回源数据库，避免令牌过期前的权限漂移。 */
  vipExp: number | null;
  typ: 'access';
}

export function signAccessToken(params: { userId: string; role: UserRole; vipExpiresAt: Date | null }): {
  token: string;
  expiresAt: Date;
} {
  const payload: AccessTokenPayload = {
    sub: params.userId,
    role: params.role,
    vipExp: params.vipExpiresAt ? Math.floor(params.vipExpiresAt.getTime() / 1000) : null,
    typ: 'access',
  };
  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'videox',
  });
  const decoded = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(decoded.exp * 1000) };
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'videox' }) as AccessTokenPayload;
    return payload.typ === 'access' ? payload : null;
  } catch {
    return null;
  }
}

/** refresh token 明文只出现在 cookie 里，数据库只存 SHA-256。 */
export function createRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString('base64url');
  return {
    raw,
    hash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    // 开发期三个前端跑在不同端口，同站不同源，lax 足够且能跟随顶层导航。
    sameSite: env.isProd ? 'strict' : 'lax',
    secure: env.isProd,
    path: '/api/auth',
    expires: expiresAt,
    signed: false,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
