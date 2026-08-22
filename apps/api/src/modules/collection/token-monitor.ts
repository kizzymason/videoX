// ========================================================================
// 号池 token 监控：列表序列化 + 管理后台可视化快照
// ========================================================================

import { desc, eq, sql } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import { getPoolConfig } from './storage/config.js';
import type { AccountPoolEntry } from './types.js';

/** 取号前静默刷新阈值。超过此时长且托管了密码，会先重新登录再使用。 */
export const TOKEN_SILENT_REFRESH_MS = 4 * 60 * 1000;
export const TOKEN_FRESH_SECONDS = Math.floor(TOKEN_SILENT_REFRESH_MS / 1000);
export const TOKEN_STALE_SECONDS = 10 * 60;

export type TokenFreshness = 'fresh' | 'due' | 'stale' | 'unknown';
export type TokenRefreshSource = 'checkout' | 'manual' | 'health_check' | 'credentials_update' | 'login';

export interface PublicPoolAccount {
  id: string;
  targetSite: string;
  uid: string;
  token: string;
  username: string | null;
  loginUsername: string | null;
  isVip: boolean;
  vipExpiresAt: string | Date | null;
  status: string;
  usageCount: number;
  lastUsedAt: string | Date | null;
  lastCheckAt: string | Date | null;
  createdAt: string | Date | null | undefined;
  tokenUpdatedAt: string | Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  hasCredentials: boolean;
  autoRefreshEnabled: boolean;
  tokenAgeSeconds: number | null;
  tokenFreshness: TokenFreshness;
  nextSilentRefreshAt: string | null;
}

export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function tokenAgeSeconds(tokenUpdatedAt: string | Date | null | undefined): number | null {
  const iso = toIso(tokenUpdatedAt);
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

export function tokenFreshnessOf(ageSeconds: number | null): TokenFreshness {
  if (ageSeconds === null) return 'unknown';
  if (ageSeconds < TOKEN_FRESH_SECONDS) return 'fresh';
  if (ageSeconds < TOKEN_STALE_SECONDS) return 'due';
  return 'stale';
}

export function serializePoolAccount(acc: AccountPoolEntry): PublicPoolAccount {
  const hasCredentials = Boolean(acc.loginUsername && acc.loginPasswordEncrypted);
  const age = tokenAgeSeconds(acc.tokenUpdatedAt);
  const updatedAtMs = toIso(acc.tokenUpdatedAt);
  return {
    id: acc.id,
    targetSite: acc.targetSite,
    uid: acc.uid,
    token: `${acc.token.slice(0, 8)}…`,
    username: acc.username ?? null,
    loginUsername: acc.loginUsername ?? null,
    isVip: acc.isVip,
    vipExpiresAt: acc.vipExpiresAt ?? null,
    status: acc.status,
    usageCount: acc.usageCount,
    lastUsedAt: acc.lastUsedAt ?? null,
    lastCheckAt: acc.lastCheckAt ?? null,
    createdAt: acc.createdAt,
    tokenUpdatedAt: acc.tokenUpdatedAt ?? null,
    consecutiveFailures: acc.consecutiveFailures ?? 0,
    lastError: acc.lastError ?? null,
    hasCredentials,
    autoRefreshEnabled: hasCredentials && acc.status === 'active',
    tokenAgeSeconds: age,
    tokenFreshness: tokenFreshnessOf(age),
    nextSilentRefreshAt:
      hasCredentials && updatedAtMs
        ? new Date(new Date(updatedAtMs).getTime() + TOKEN_SILENT_REFRESH_MS).toISOString()
        : null,
  };
}

export async function writePoolEvent(params: {
  level: 'info' | 'warn' | 'error';
  message: string;
  accountId?: string | null;
  event: string;
  uid?: string | null;
  source?: TokenRefreshSource | string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(t.collectionLogs).values({
      jobId: null,
      level: params.level,
      message: params.message,
      accountId: params.accountId ?? null,
      context: {
        event: params.event,
        uid: params.uid ?? null,
        source: params.source ?? null,
        ...(params.extra ?? {}),
      },
    });
  } catch {
    // 监控日志失败不能打断取号 / 登录
  }
}

export async function getTokenMonitorSnapshot(targetSite: string) {
  const pool = await getPoolConfig(targetSite);
  const accounts = await db.select().from(t.accountPools).where(eq(t.accountPools.targetSite, targetSite));

  const counts = {
    total: accounts.length,
    withCredentials: 0,
    withoutCredentials: 0,
    autoRefreshReady: 0,
    fresh: 0,
    due: 0,
    stale: 0,
    unknown: 0,
  };

  let lastCheckMs = 0;
  for (const row of accounts) {
    const acc = row as unknown as AccountPoolEntry;
    const publicAcc = serializePoolAccount(acc);
    if (publicAcc.hasCredentials) counts.withCredentials += 1;
    else counts.withoutCredentials += 1;
    if (publicAcc.autoRefreshEnabled) counts.autoRefreshReady += 1;
    counts[publicAcc.tokenFreshness] += 1;
    const check = toIso(acc.lastCheckAt);
    if (check) lastCheckMs = Math.max(lastCheckMs, new Date(check).getTime());
  }

  const [latestHealth] = await db
    .select({ createdAt: t.collectionLogs.createdAt })
    .from(t.collectionLogs)
    .where(sql`${t.collectionLogs.context} ->> 'event' = 'pool_health_check'`)
    .orderBy(desc(t.collectionLogs.createdAt))
    .limit(1);

  const healthLogMs = latestHealth?.createdAt ? new Date(latestHealth.createdAt).getTime() : 0;
  const lastHealthCheckAt = lastCheckMs || healthLogMs ? new Date(Math.max(lastCheckMs, healthLogMs)).toISOString() : null;
  const intervalMs = Math.max(5, pool.healthCheckIntervalMinutes || 60) * 60 * 1000;
  const nextHealthCheckAt = lastHealthCheckAt
    ? new Date(new Date(lastHealthCheckAt).getTime() + intervalMs).toISOString()
    : null;

  const eventRows = await db
    .select()
    .from(t.collectionLogs)
    .where(
      sql`${t.collectionLogs.context} ->> 'event' in ('token_login', 'token_refresh', 'token_refresh_failed', 'pool_health_check')`,
    )
    .orderBy(desc(t.collectionLogs.createdAt))
    .limit(20);

  const events = eventRows.map((row) => {
    const context = (row.context ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      createdAt: row.createdAt,
      level: row.level,
      message: row.message,
      accountId: row.accountId,
      event: typeof context.event === 'string' ? context.event : null,
      uid: typeof context.uid === 'string' ? context.uid : null,
      source: typeof context.source === 'string' ? context.source : null,
    };
  });

  return {
    silentRefreshAfterSeconds: TOKEN_FRESH_SECONDS,
    staleAfterSeconds: TOKEN_STALE_SECONDS,
    healthCheckIntervalMinutes: pool.healthCheckIntervalMinutes,
    lastHealthCheckAt,
    nextHealthCheckAt,
    counts,
    events,
  };
}
