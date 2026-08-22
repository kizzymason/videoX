// ========================================================================
// 号池 token 监控：列表序列化 + 管理后台可视化快照
// ========================================================================

import { desc, eq, sql } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import {
  nextHealthCheckAt,
  resolveHealthCheckIntervalMinutes,
  tokenFreshnessFromCheck,
  type TokenFreshness,
} from './pool-schedule.js';
import { getPoolConfig } from './storage/config.js';
import type { AccountPoolEntry } from './types.js';

export type { TokenFreshness };

export type TokenRefreshSource =
  | 'auth_retry'
  | 'manual'
  | 'health_check'
  | 'credentials_update'
  | 'login';

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

export function serializePoolAccount(
  acc: AccountPoolEntry,
  options?: { healthCheckIntervalMinutes?: number },
): PublicPoolAccount {
  const intervalMinutes = resolveHealthCheckIntervalMinutes(options?.healthCheckIntervalMinutes);
  const hasCredentials = Boolean(acc.loginUsername && acc.loginPasswordEncrypted);
  const age = tokenAgeSeconds(acc.tokenUpdatedAt);
  const nextCheck = nextHealthCheckAt(acc.lastCheckAt, intervalMinutes);
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
    tokenFreshness: tokenFreshnessFromCheck(acc.lastCheckAt, intervalMinutes),
    nextSilentRefreshAt: hasCredentials && nextCheck ? nextCheck.toISOString() : null,
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
  const intervalMinutes = resolveHealthCheckIntervalMinutes(pool.healthCheckIntervalMinutes);
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

  for (const row of accounts) {
    const acc = row as unknown as AccountPoolEntry;
    const publicAcc = serializePoolAccount(acc, { healthCheckIntervalMinutes: intervalMinutes });
    if (publicAcc.hasCredentials) counts.withCredentials += 1;
    else counts.withoutCredentials += 1;
    if (publicAcc.autoRefreshEnabled) counts.autoRefreshReady += 1;
    counts[publicAcc.tokenFreshness] += 1;
  }

  const [latestHealth] = await db
    .select({ createdAt: t.collectionLogs.createdAt })
    .from(t.collectionLogs)
    .where(sql`${t.collectionLogs.context} ->> 'event' = 'pool_health_check'`)
    .orderBy(desc(t.collectionLogs.createdAt))
    .limit(1);

  const [latestRefresh] = await db
    .select({ createdAt: t.collectionLogs.createdAt })
    .from(t.collectionLogs)
    .where(sql`${t.collectionLogs.context} ->> 'event' = 'token_refresh'`)
    .orderBy(desc(t.collectionLogs.createdAt))
    .limit(1);

  // 巡检时间只看巡检日志，不要和 token 刷新写入的 lastCheckAt 混在一起。
  const healthLogMs = latestHealth?.createdAt ? new Date(latestHealth.createdAt).getTime() : 0;
  const lastHealthCheckAt = healthLogMs ? new Date(healthLogMs).toISOString() : null;
  const intervalMs = intervalMinutes * 60 * 1000;
  const nextPoolHealthCheckAt = lastHealthCheckAt
    ? new Date(new Date(lastHealthCheckAt).getTime() + intervalMs).toISOString()
    : null;
  const lastTokenRefreshAt = latestRefresh?.createdAt
    ? new Date(latestRefresh.createdAt).toISOString()
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
    tokenRefreshPolicy: 'on_invalid' as const,
    silentRefreshAfterSeconds: intervalMinutes * 60,
    staleAfterSeconds: intervalMinutes * 120,
    healthCheckIntervalMinutes: intervalMinutes,
    lastHealthCheckAt,
    nextHealthCheckAt: nextPoolHealthCheckAt,
    lastTokenRefreshAt,
    counts,
    events,
  };
}
