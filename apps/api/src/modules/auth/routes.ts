import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type AuthSession,
  type CurrentUser,
} from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { authLimiter, clientIp } from '../../middleware/request-context.js';
import { requireAuth } from '../../middleware/auth.js';
import { body, validate } from '../../middleware/validate.js';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './tokens.js';
import {
  authenticate,
  changePassword,
  getUserById,
  issueSession,
  listActiveSessions,
  markLogin,
  registerUser,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  toCurrentUser,
} from './service.js';
import { recordAnalyticsServerEvent } from '../analytics/service.js';

export const authRouter: Router = Router();

function sessionContext(req: Parameters<typeof clientIp>[0]) {
  return { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '') };
}

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ email?: string; username: string; password: string; displayName?: string }>(req);
    const user = await registerUser(input);
    const ctx = sessionContext(req);
    const { access, refresh } = await issueSession(user, ctx);
    await markLogin(user.id, ctx.ip);

    setRefreshCookie(res, refresh.raw, refresh.expiresAt);
    void recordAnalyticsServerEvent({ event: 'signup', userId: user.id });

    const payload: AuthSession = {
      user: toCurrentUser(user),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
    ok(res, payload, '注册成功');
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ identifier: string; password: string }>(req);
    const user = await authenticate(input.identifier, input.password);
    const ctx = sessionContext(req);
    const { access, refresh } = await issueSession(user, ctx);
    await markLogin(user.id, ctx.ip);

    setRefreshCookie(res, refresh.raw, refresh.expiresAt);
    void recordAnalyticsServerEvent({ event: 'login', userId: user.id });

    const payload: AuthSession = {
      user: toCurrentUser({ ...user, lastLoginAt: new Date() }),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
    ok(res, payload, '登录成功');
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw AppError.unauthorized('登录状态已失效');

    const { user, access, refresh } = await rotateRefreshToken(raw, sessionContext(req));
    setRefreshCookie(res, refresh.raw, refresh.expiresAt);

    const payload: AuthSession = {
      user: toCurrentUser(user),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
    ok(res, payload);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    ok(res, null, '已退出登录');
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.auth!.id);
    clearRefreshCookie(res);
    ok(res, null, '已退出全部设备');
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.auth!.id);
    if (!user) throw AppError.unauthorized('账号不存在');
    ok(res, toCurrentUser(user) satisfies CurrentUser);
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ displayName?: string; bio?: string | null; avatarUrl?: string | null }>(req);
    const [updated] = await db
      .update(t.users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(t.users.id, req.auth!.id))
      .returning();
    if (!updated) throw AppError.notFound('用户不存在');
    ok(res, toCurrentUser(updated), '资料已更新');
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{ currentPassword: string; newPassword: string }>(req);
    await changePassword(req.auth!.id, input.currentPassword, input.newPassword);
    clearRefreshCookie(res);
    ok(res, null, '密码已修改，请重新登录');
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await listActiveSessions(req.auth!.id);
    ok(
      res,
      sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    );
  }),
);
