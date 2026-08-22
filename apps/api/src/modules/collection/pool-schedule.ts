// ========================================================================
// 号池巡检 / token 到期判定（纯函数，供调度器与测试共用）
// ========================================================================

/** 取号或定时巡检时，超过此时长且托管了密码，会重新登录换 token（与手动刷新相同）。 */
export const TOKEN_SILENT_REFRESH_MS = 4 * 60 * 1000;
export const TOKEN_FRESH_SECONDS = Math.floor(TOKEN_SILENT_REFRESH_MS / 1000);
export const TOKEN_STALE_SECONDS = 10 * 60;

export const DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES = 10;
export const MIN_HEALTH_CHECK_INTERVAL_MINUTES = 1;
export const MAX_HEALTH_CHECK_INTERVAL_MINUTES = 120;

export function resolveHealthCheckIntervalMinutes(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES;
  if (n < MIN_HEALTH_CHECK_INTERVAL_MINUTES) return MIN_HEALTH_CHECK_INTERVAL_MINUTES;
  if (n > MAX_HEALTH_CHECK_INTERVAL_MINUTES) return MAX_HEALTH_CHECK_INTERVAL_MINUTES;
  return n;
}

export function isTokenDueForRefresh(
  tokenUpdatedAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (!tokenUpdatedAt) return true;
  const ms = tokenUpdatedAt instanceof Date ? tokenUpdatedAt.getTime() : new Date(tokenUpdatedAt).getTime();
  if (Number.isNaN(ms)) return true;
  return now - ms >= TOKEN_SILENT_REFRESH_MS;
}

export interface TokenRefreshCandidate {
  id: string;
  status: string;
  uid?: string | null;
  loginUsername?: string | null;
  loginPasswordEncrypted?: string | null;
  tokenUpdatedAt?: Date | string | null;
}

/** 有托管密码、未封禁、且 token 已到期或从未写入的账号。 */
export function selectAccountsDueForTokenRefresh<T extends TokenRefreshCandidate>(
  accounts: T[],
  now = Date.now(),
): T[] {
  return accounts.filter((account) => {
    if (account.status === 'banned') return false;
    if (!account.loginUsername || !account.loginPasswordEncrypted) return false;
    return isTokenDueForRefresh(account.tokenUpdatedAt, now);
  });
}
