import { eq, sql } from 'drizzle-orm';
import type { StorageProfile } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { createStorageDriver, type DriverConfig, type Storage } from './driver.js';

const MASK = '••••••••';

type ProfileRow = typeof t.storageProfiles.$inferSelect;

let cached: { profileId: string; storage: Storage } | null = null;

function configFromFields(driver: DriverConfig['driver'], cfg: Record<string, unknown>): DriverConfig {
  return {
    driver,
    root: typeof cfg.root === 'string' ? cfg.root : undefined,
    endpoint: typeof cfg.endpoint === 'string' ? cfg.endpoint : undefined,
    region: typeof cfg.region === 'string' ? cfg.region : undefined,
    bucket: typeof cfg.bucket === 'string' ? cfg.bucket : undefined,
    accessKeyId: typeof cfg.accessKeyId === 'string' ? cfg.accessKeyId : undefined,
    secretAccessKey: typeof cfg.secretAccessKey === 'string' ? cfg.secretAccessKey : undefined,
    forcePathStyle: typeof cfg.forcePathStyle === 'boolean' ? cfg.forcePathStyle : undefined,
    publicBaseUrl: typeof cfg.publicBaseUrl === 'string' ? cfg.publicBaseUrl : undefined,
  };
}

function configFromRow(row: ProfileRow): DriverConfig {
  return configFromFields(row.driver, (row.config ?? {}) as Record<string, unknown>);
}

function envFallbackConfig(): DriverConfig {
  return {
    driver: env.STORAGE_DRIVER,
    root: env.storageRoot,
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || undefined,
  };
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (!config.secretAccessKey) return { ...config };
  return { ...config, secretAccessKey: MASK };
}

function toProfile(row: ProfileRow): StorageProfile {
  return {
    id: row.id,
    name: row.name,
    driver: row.driver,
    isActive: row.isActive,
    config: maskConfig((row.config ?? {}) as Record<string, unknown>) as StorageProfile['config'],
    createdAt: row.createdAt.toISOString(),
  };
}

function invalidateCache(profileId?: string): void {
  if (!cached) return;
  if (!profileId || cached.profileId === profileId) cached = null;
}

/** 读当前激活配置，热切换：激活变更后下次 getStorage 换驱动。 */
export async function getStorage(): Promise<Storage> {
  const [active] = await db.select().from(t.storageProfiles).where(eq(t.storageProfiles.isActive, true)).limit(1);
  if (active) {
    if (cached?.profileId === active.id) return cached.storage;
    const storage = createStorageDriver(configFromRow(active));
    cached = { profileId: active.id, storage };
    return storage;
  }
  if (cached?.profileId === 'env') return cached.storage;
  const storage = createStorageDriver(envFallbackConfig());
  cached = { profileId: 'env', storage };
  return storage;
}

export async function listStorageProfiles(): Promise<StorageProfile[]> {
  const rows = await db.select().from(t.storageProfiles).orderBy(t.storageProfiles.createdAt);
  return rows.map(toProfile);
}

export async function createStorageProfile(input: {
  name: string;
  driver: 'local' | 's3';
  isActive?: boolean;
  config?: Record<string, unknown>;
}): Promise<StorageProfile> {
  return db.transaction(async (tx) => {
    if (input.isActive) {
      await tx.update(t.storageProfiles).set({ isActive: false, updatedAt: new Date() });
    }
    const [row] = await tx
      .insert(t.storageProfiles)
      .values({
        name: input.name,
        driver: input.driver,
        isActive: Boolean(input.isActive),
        config: input.config ?? {},
      })
      .returning();
    if (input.isActive) invalidateCache();
    return toProfile(row!);
  });
}

export async function updateStorageProfile(
  id: string,
  input: { name?: string; driver?: 'local' | 's3'; isActive?: boolean; config?: Record<string, unknown> },
): Promise<StorageProfile> {
  const [existing] = await db.select().from(t.storageProfiles).where(eq(t.storageProfiles.id, id)).limit(1);
  if (!existing) throw AppError.notFound('存储配置不存在');

  const nextConfig = { ...((existing.config ?? {}) as Record<string, unknown>), ...(input.config ?? {}) };
  if (input.config && (input.config.secretAccessKey === MASK || input.config.secretAccessKey === '')) {
    nextConfig.secretAccessKey = (existing.config as Record<string, unknown>).secretAccessKey;
  }

  return db.transaction(async (tx) => {
    if (input.isActive) {
      await tx.update(t.storageProfiles).set({ isActive: false, updatedAt: new Date() });
    }
    const [row] = await tx
      .update(t.storageProfiles)
      .set({
        name: input.name ?? existing.name,
        driver: input.driver ?? existing.driver,
        isActive: input.isActive ?? existing.isActive,
        config: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(t.storageProfiles.id, id))
      .returning();
    invalidateCache(id);
    if (input.isActive) invalidateCache();
    return toProfile(row!);
  });
}

export async function activateStorageProfile(id: string): Promise<void> {
  const [existing] = await db.select({ id: t.storageProfiles.id }).from(t.storageProfiles).where(eq(t.storageProfiles.id, id)).limit(1);
  if (!existing) throw AppError.notFound('存储配置不存在');

  await db.transaction(async (tx) => {
    await tx.update(t.storageProfiles).set({ isActive: false, updatedAt: new Date() });
    await tx
      .update(t.storageProfiles)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(t.storageProfiles.id, id));
  });
  invalidateCache();
}

export async function deleteStorageProfile(id: string): Promise<void> {
  const [existing] = await db.select().from(t.storageProfiles).where(eq(t.storageProfiles.id, id)).limit(1);
  if (!existing) throw AppError.notFound('存储配置不存在');
  if (existing.isActive) throw AppError.badRequest('不能删除当前正在使用的存储配置');
  await db.delete(t.storageProfiles).where(eq(t.storageProfiles.id, id));
}

export async function testStorageProfile(
  id: string,
  override?: { driver: 'local' | 's3'; config: Record<string, unknown> },
): Promise<{ ok: boolean; message: string }> {
  const [existing] = await db.select().from(t.storageProfiles).where(eq(t.storageProfiles.id, id)).limit(1);
  if (!existing) throw AppError.notFound('存储配置不存在');

  const mergedConfig = {
    ...((existing.config ?? {}) as Record<string, unknown>),
    ...(override?.config ?? {}),
  };
  if (override?.config && (override.config.secretAccessKey === MASK || override.config.secretAccessKey === '')) {
    mergedConfig.secretAccessKey = (existing.config as Record<string, unknown>).secretAccessKey;
  }

  const config: DriverConfig = override
    ? configFromFields(override.driver, mergedConfig)
    : configFromRow({ ...existing, config: mergedConfig });

  const probe = `videox-probe/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const payload = Buffer.from('videox-storage-ok', 'utf8');

  try {
    const storage = createStorageDriver(config);
    await storage.put(probe, payload, 'text/plain');
    const back = await storage.getBuffer(probe);
    await storage.delete(probe);
    if (back.toString('utf8') !== 'videox-storage-ok') {
      return { ok: false, message: '写入后读回内容不一致' };
    }
    return { ok: true, message: '连接正常，读写成功' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '测试连接失败';
    logger.warn({ err: error, profileId: id }, '存储测试连接失败');
    return { ok: false, message };
  }
}

/** 仪表盘 totals.storageBytes：片源 + HLS 产物账本合计。失败返回 0，不把概览打挂。 */
export async function getStorageUsage(): Promise<number> {
  try {
    const [row] = await db
      .select({
        bytes: sql<number>`coalesce(sum(coalesce(${t.videos.sourceSizeBytes}, 0) + coalesce(${t.videos.outputBytes}, 0)), 0)::bigint`,
      })
      .from(t.videos);
    return Number(row?.bytes ?? 0);
  } catch (error) {
    logger.warn({ err: error }, '统计存储用量失败');
    return 0;
  }
}
