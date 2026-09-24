import { eq } from 'drizzle-orm';
import {
  algoWeightsSchema,
  isValidAdminPath,
  normalizeAdminPath,
  siteSettingsSchema,
  type AlgoWeights,
  type SiteSettings,
} from '@videox/shared';
import { env } from '../../config/env.js';
import { db, t } from '../../core/db.js';

const SITE_KEY = 'site';
const ALGO_KEY = 'algo_weights';

/**
 * 后台入口路径的兜底值，只存在于服务端：packages/shared 会被打进前台的公开 JS，
 * 把默认值放那里等于把入口写在明面上。优先级：数据库 > ADMIN_ENTRY_PATH > 这里。
 */
const FALLBACK_ADMIN_PATH = 'pg7x92k41';

function resolveAdminPath(stored: string | undefined): string {
  for (const candidate of [stored, env.ADMIN_ENTRY_PATH, FALLBACK_ADMIN_PATH]) {
    const value = normalizeAdminPath(candidate ?? '');
    if (isValidAdminPath(value)) return value;
  }
  return FALLBACK_ADMIN_PATH;
}

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
  const parsed = siteSettingsSchema.parse({ siteName: 'PandaGV', ...raw });
  const value: SiteSettings = { ...parsed, adminPath: resolveAdminPath(parsed.adminPath) };
  siteCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveSiteSettings(input: unknown): Promise<SiteSettings> {
  const parsed = siteSettingsSchema.parse(input);
  // 没带 adminPath 的老客户端不该把入口清掉，沿用当前生效的值。
  const current = await getSiteSettings();
  const value: SiteSettings = { ...parsed, adminPath: resolveAdminPath(parsed.adminPath ?? current.adminPath) };
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
