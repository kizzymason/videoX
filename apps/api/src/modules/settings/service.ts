import { eq } from 'drizzle-orm';
import {
  algoWeightsSchema,
  siteSettingsSchema,
  type AlgoWeights,
  type SiteSettings,
} from '@videox/shared';
import { db, t } from '../../core/db.js';

const SITE_KEY = 'site';
const ALGO_KEY = 'algo_weights';

/**
 * 站点设置几乎每个请求都要读，缓存在进程内存里，
 * 后台保存时主动失效。多实例部署时可换成 Redis pub/sub。
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
let siteCache: CacheEntry<SiteSettings> | null = null;
let algoCache: CacheEntry<AlgoWeights> | null = null;

async function readSetting(key: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(t.settings).where(eq(t.settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (siteCache && siteCache.expiresAt > Date.now()) return siteCache.value;
  const raw = (await readSetting(SITE_KEY)) ?? {};
  // 用 schema 兜底：即使数据库里的记录缺字段，也能拿到完整的默认值。
  const value = siteSettingsSchema.parse({ siteName: 'videoX', ...raw });
  siteCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveSiteSettings(input: unknown): Promise<SiteSettings> {
  const value = siteSettingsSchema.parse(input);
  await db
    .insert(t.settings)
    .values({ key: SITE_KEY, value: value as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: t.settings.key,
      set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  siteCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function getAlgoWeights(): Promise<AlgoWeights> {
  if (algoCache && algoCache.expiresAt > Date.now()) return algoCache.value;
  const raw = (await readSetting(ALGO_KEY)) ?? {};
  const value = algoWeightsSchema.parse(raw);
  algoCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveAlgoWeights(input: unknown): Promise<AlgoWeights> {
  const value = algoWeightsSchema.parse(input);
  await db
    .insert(t.settings)
    .values({ key: ALGO_KEY, value: value as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: t.settings.key,
      set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  algoCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateSettingsCache(): void {
  siteCache = null;
  algoCache = null;
}
