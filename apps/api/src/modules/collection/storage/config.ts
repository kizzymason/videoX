// ========================================================================
// 采集系统 - 配置管理
// ========================================================================

import { eq } from 'drizzle-orm';
import {
  normalizeAutoImportConfig,
  normalizeScheduleKinds,
  type CollectionAutoImportConfig,
} from '@videox/shared';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';
import {
  DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES,
  resolveHealthCheckIntervalMinutes,
} from '../pool-schedule.js';
import type { StorageStrategyConfig, CollectionScheduleConfig, CollectionPoolConfig } from '../types.js';

/**
 * 读取采集配置
 */
export async function getCollectionConfig(key: string): Promise<Record<string, unknown> | null> {
  const config = await db
    .select()
    .from(t.collectionConfigs)
    .where(eq(t.collectionConfigs.key, key))
    .limit(1);
  
  return config[0]?.value ?? null;
}

/**
 * 写入采集配置（upsert 语义）
 */
export async function setCollectionConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const existing = await getCollectionConfig(key);
  
  if (existing) {
    await db
      .update(t.collectionConfigs)
      .set({
        value,
        updatedAt: new Date(),
      })
      .where(eq(t.collectionConfigs.key, key));
  } else {
    await db
      .insert(t.collectionConfigs)
      .values({ key, value });
  }
  
  logger.info({ key }, '采集配置已更新');
}

// --------------------------------------------------------------------------
// 类型化的配置读取器
// --------------------------------------------------------------------------

const DEFAULT_STORAGE_STRATEGY: StorageStrategyConfig = {
  mode: 'hybrid',
  growthMode: 'rapid',
  latestDays: 30,
  popularViewThreshold: 10000,
  maxStorageGB: 500,
  monthlyBudgetUSD: 100,
};

const DEFAULT_SCHEDULE_CONFIG: CollectionScheduleConfig = {
  enabled: true,
  kinds: [],
  pageCountPerRun: 5,
  startTime: '03:00',
  incremental: true,
};

const DEFAULT_POOL_CONFIG: CollectionPoolConfig = {
  minAccountCount: 3,
  vipWeightMultiplier: 3,
  healthCheckIntervalMinutes: DEFAULT_HEALTH_CHECK_INTERVAL_MINUTES,
  autoRemoveFailedAfterAttempts: 5,
};

export async function getStorageStrategyConfig(): Promise<StorageStrategyConfig> {
  const raw = await getCollectionConfig('strategy:storage');
  return { ...DEFAULT_STORAGE_STRATEGY, ...(raw ?? {}) } as StorageStrategyConfig;
}

export async function setStorageStrategyConfig(config: Partial<StorageStrategyConfig>): Promise<void> {
  const current = await getStorageStrategyConfig();
  await setCollectionConfig('strategy:storage', { ...current, ...config });
}

export async function getScheduleConfig(kind: 'daily' | 'weekly'): Promise<CollectionScheduleConfig> {
  const raw = await getCollectionConfig(`schedule:${kind}`);
  const merged = { ...DEFAULT_SCHEDULE_CONFIG, ...(raw ?? {}) } as CollectionScheduleConfig;
  // 旧配置里的单个 kind 从未被调度使用过，不能当成已勾选。
  merged.kinds = normalizeScheduleKinds((raw as { kinds?: unknown } | null)?.kinds);
  return merged;
}

export async function setScheduleConfig(kind: 'daily' | 'weekly', config: Partial<CollectionScheduleConfig>): Promise<void> {
  const current = await getScheduleConfig(kind);
  const next = { ...current, ...config };
  if (config.kinds !== undefined) next.kinds = normalizeScheduleKinds(config.kinds);
  const { kind: _legacyKind, ...stored } = next as CollectionScheduleConfig & { kind?: string };
  await setCollectionConfig(`schedule:${kind}`, stored);
}

/**
 * 自动导入配置。缺省即启用：采集完不该还要人手点一次导入。
 * 未落库时返回默认值，管理员在采集视频页拨一次开关就会写进 collection_configs。
 */
export async function getAutoImportConfig(): Promise<CollectionAutoImportConfig> {
  return normalizeAutoImportConfig(await getCollectionConfig('import:auto'));
}

export async function setAutoImportConfig(
  patch: Partial<CollectionAutoImportConfig>,
): Promise<CollectionAutoImportConfig> {
  const next = normalizeAutoImportConfig({ ...(await getAutoImportConfig()), ...patch });
  await setCollectionConfig('import:auto', next as unknown as Record<string, unknown>);
  return next;
}

export async function getPoolConfig(targetSite: string): Promise<CollectionPoolConfig> {
  const raw = (await getCollectionConfig(`pool:${targetSite}`)) ?? {};
  const merged = { ...DEFAULT_POOL_CONFIG, ...raw } as CollectionPoolConfig;
  return {
    ...merged,
    healthCheckIntervalMinutes: resolveHealthCheckIntervalMinutes(merged.healthCheckIntervalMinutes),
  };
}

export async function setPoolConfig(targetSite: string, config: Partial<CollectionPoolConfig>): Promise<void> {
  const current = await getPoolConfig(targetSite);
  const next = { ...current, ...config };
  if (config.healthCheckIntervalMinutes !== undefined) {
    next.healthCheckIntervalMinutes = resolveHealthCheckIntervalMinutes(config.healthCheckIntervalMinutes);
  }
  await setCollectionConfig(`pool:${targetSite}`, next);
}
