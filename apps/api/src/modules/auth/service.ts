import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { CurrentUser } from '@videox/shared';
import { db, t, sqlRows } from '../../core/db.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { createRefreshToken, hashRefreshToken, signAccessToken } from './tokens.js';
import { getSiteSettings } from '../settings/service.js';

// OWASP 推荐的 argon2id 参数，在 19MB 内存下单次约 50ms。
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export type UserRow = typeof t.users.$inferSelect;

export function toCurrentUser(user: UserRow): CurrentUser {
  const isVip = user.role === 'admin' || (user.vipExpiresAt !== null && user.vipExpiresAt.getTime() > Date.now());
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
    status: user.status,
    isVip,
    vipExpiresAt: user.vipExpiresAt?.toISOString() ?? null,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    videoCount: user.videoCount,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(plain: string, digest: string): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export interface SessionContext {
  ip: string;
  userAgent: string;
}

export async function issueSession(user: UserRow, ctx: SessionContext) {
  const access = signAccessToken({ userId: user.id, role: user.role, vipExpiresAt: user.vipExpiresAt });
  const refresh = createRefreshToken();

  await db.insert(t.refreshTokens).values({
    userId: user.id,
    tokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
    userAgent: ctx.userAgent.slice(0, 300),
    ip: ctx.ip.slice(0, 64),
  });

  return { access, refresh };
}

export async function registerUser(input: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<UserRow> {
  const settings = await getSiteSettings();
  if (!settings.allowRegistration) {
    throw new AppError({ message: '站点当前已关闭注册', code: ErrorCode.REGISTRATION_CLOSED, status: 403 });
  }

  const emailNormalized = input.email.trim().toLowerCase();
  const usernameNormalized = input.username.trim().toLowerCase();

  const existing = await db
    .select({ id: t.users.id, email: t.users.emailNormalized, username: t.users.usernameNormalized })
    .from(t.users)
    .where(
      sql`${t.users.emailNormalized} = ${emailNormalized} OR ${t.users.usernameNormalized} = ${usernameNormalized}`,
    )
    .limit(1);

  if (existing.length > 0) {
    const hit = existing[0]!;
    throw AppError.conflict(hit.email === emailNormalized ? '该邮箱已被注册' : '该用户名已被占用');
  }

  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(t.users)
    .values({
      email: input.email.trim(),
      emailNormalized,
      username: input.username.trim(),
      usernameNormalized,
      passwordHash,
      displayName: input.displayName?.trim() || input.username.trim(),
    })
    .returning();

  return user!;
}

export async function authenticate(identifier: string, password: string): Promise<UserRow> {
  const normalized = identifier.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(t.users)
    .where(sql`${t.users.emailNormalized} = ${normalized} OR ${t.users.usernameNormalized} = ${normalized}`)
    .limit(1);

  // 即便用户不存在也执行一次哈希校验，抹平时间差，避免用户名枚举。
  const digest = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000';
  const okPassword = await verifyPassword(password, digest);

  if (!user || !okPassword) {
    throw AppError.unauthorized('账号或密码不正确', ErrorCode.INVALID_CREDENTIALS);
  }
  if (user.status === 'banned') {
    throw AppError.forbidden('账号已被封禁', ErrorCode.ACCOUNT_BANNED);
  }
  return user;
}

/**
 * 轮换刷新：旧令牌立即作废并指向新令牌。
 * 如果检测到已作废的令牌被再次使用，说明 cookie 可能泄露，直接吊销该用户全部会话。
 */
export async function rotateRefreshToken(rawToken: string, ctx: SessionContext) {
  const tokenHash = hashRefreshToken(rawToken);

  const [existing] = await db
    .select()
    .from(t.refreshTokens)
    .where(eq(t.refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!existing) throw AppError.unauthorized('登录状态已失效', ErrorCode.TOKEN_INVALID);

  if (existing.revokedAt) {
    await db
      .update(t.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(t.refreshTokens.userId, existing.userId), isNull(t.refreshTokens.revokedAt)));
    throw AppError.unauthorized('检测到异常登录，已退出全部设备，请重新登录', ErrorCode.TOKEN_INVALID);
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('登录已过期，请重新登录', ErrorCode.TOKEN_EXPIRED);
  }

  const [user] = await db.select().from(t.users).where(eq(t.users.id, existing.userId)).limit(1);
  if (!user) throw AppError.unauthorized('账号不存在');
  if (user.status === 'banned') throw AppError.forbidden('账号已被封禁', ErrorCode.ACCOUNT_BANNED);

  const next = createRefreshToken();
  const [inserted] = await db
    .insert(t.refreshTokens)
    .values({
      userId: user.id,
      tokenHash: next.hash,
      expiresAt: next.expiresAt,
      userAgent: ctx.userAgent.slice(0, 300),
      ip: ctx.ip.slice(0, 64),
    })
    .returning({ id: t.refreshTokens.id });

  await db
    .update(t.refreshTokens)
    .set({ revokedAt: new Date(), replacedById: inserted!.id })
    .where(eq(t.refreshTokens.id, existing.id));

  const access = signAccessToken({ userId: user.id, role: user.role, vipExpiresAt: user.vipExpiresAt });
  return { user, access, refresh: next };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await db
    .update(t.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(t.refreshTokens.tokenHash, hashRefreshToken(rawToken)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(t.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(t.refreshTokens.userId, userId), isNull(t.refreshTokens.revokedAt)));
}

export async function listActiveSessions(userId: string) {
  return db
    .select({
      id: t.refreshTokens.id,
      userAgent: t.refreshTokens.userAgent,
      ip: t.refreshTokens.ip,
      createdAt: t.refreshTokens.createdAt,
      expiresAt: t.refreshTokens.expiresAt,
    })
    .from(t.refreshTokens)
    .where(
      and(
        eq(t.refreshTokens.userId, userId),
        isNull(t.refreshTokens.revokedAt),
        gt(t.refreshTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`${t.refreshTokens.createdAt} desc`)
    .limit(20);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const [user] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  if (!user) throw AppError.notFound('用户不存在');

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw AppError.badRequest('当前密码不正确');

  await db
    .update(t.users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(t.users.id, userId));

  // 改密后强制其它设备重新登录。
  await revokeAllSessions(userId);
}

export async function markLogin(userId: string, ip: string): Promise<void> {
  await db
    .update(t.users)
    .set({ lastLoginAt: new Date(), lastLoginIp: ip.slice(0, 64) })
    .where(eq(t.users.id, userId));
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  const [user] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
  return user ?? null;
}

/** 清理过期与已吊销的刷新令牌，避免表无限膨胀。 */
export async function pruneRefreshTokens(): Promise<number> {
  const deleted = await sqlRows<{ id: string }>(sql`
    DELETE FROM refresh_tokens
    WHERE expires_at < now() - interval '7 days'
       OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
    RETURNING id
  `);
  return deleted.length;
}
