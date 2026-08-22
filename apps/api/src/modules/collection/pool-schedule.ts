// ========================================================================
// 号池巡检 / token 有效性判定（纯函数，供调度器与测试共用）
// ========================================================================

/**
 * 源站登录响应实测只有 token + user.{id,username,isVIP,vipTime}，没有 expires/ttl。
 * vipTime 是会员到期，不是 session 过期；token 为 32 位 hex，不能解 JWT exp。
 * 有效性以 /api/member/me 为准：巡检成功就继续用，只有失效才重新登录。
 */
export const DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES = 10;
export const MIN_HEALTH_CHECK_INTERVAL_MINUTES = 1;
export const MAX_HEALTH_CHECK_INTERVAL_MINUTES = 120;

export function resolveHealthCheckIntervalMinutes(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES;
  if (n < MIN_HEALTH_CHECK_INTERVAL_MINUTES) return MIN_HEALTH_CHECK_INTERVAL_MINUTES;
  if (n > MAX_HEALTH_CHECK_INTERVAL_MINUTES) return MAX_HEALTH_CHECK_INTERVAL_MINUTES;
  return n;
}

export function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export type TokenFreshness = 'fresh' | 'due' | 'stale' | 'unknown';

/** 按上次 /me 巡检时间判断展示状态，不是按猜测的 token 寿命。 */
export function tokenFreshnessFromCheck(
  lastCheckAt: Date | string | null | undefined,
  intervalMinutes: unknown,
  now = Date.now(),
): TokenFreshness {
  const ms = toTimestamp(lastCheckAt);
  if (ms == null) return 'unknown';
  const ageMs = Math.max(0, now - ms);
  const intervalMs = resolveHealthCheckIntervalMinutes(intervalMinutes) * 60_000;
  if (ageMs < intervalMs) return 'fresh';
  if (ageMs < intervalMs * 2) return 'due';
  return 'stale';
}

export function nextHealthCheckAt(
  lastCheckAt: Date | string | null | undefined,
  intervalMinutes: unknown,
): Date | null {
  const ms = toTimestamp(lastCheckAt);
  if (ms == null) return null;
  return new Date(ms + resolveHealthCheckIntervalMinutes(intervalMinutes) * 60_000);
}

export function isSourceAuthCode(code: unknown): boolean {
  const value = String(code ?? '');
  return value === '401' || value === '403';
}

export function isSourceAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b|\b403\b|unauthorized|unauthorised|invalid token|token.*(invalid|expired|失效)/i.test(
    message,
  );
}
