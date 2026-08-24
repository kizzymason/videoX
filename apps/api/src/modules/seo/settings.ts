// ========================================================================
// SEO 系统 - 全局配置（settings 表 key = 'seo'）
// 推送开关、IndexNow key、百度 token、AI 关键词配置。
// ========================================================================

import { eq } from 'drizzle-orm';
import { seoSettingsSchema, type SeoSettings } from '@videox/shared';
import { db, t } from '../../core/db.js';

const SEO_KEY = 'seo';
const CACHE_TTL_MS = 30_000;

export const SECRET_MASK = '••••••••';

let cache: { value: SeoSettings; expiresAt: number } | null = null;

export async function getSeoSettings(): Promise<SeoSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const [row] = await db.select().from(t.settings).where(eq(t.settings.key, SEO_KEY)).limit(1);
  const value = seoSettingsSchema.parse(row?.value ?? {});
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** 返回给管理端时隐藏密钥。IndexNow key 本身就是公开文件，不用脱敏。 */
export function maskSeoSettings(settings: SeoSettings): SeoSettings {
  return {
    ...settings,
    baidu: { ...settings.baidu, token: settings.baidu.token ? SECRET_MASK : '' },
    ai: { ...settings.ai, apiKey: settings.ai.apiKey ? SECRET_MASK : '' },
  };
}

/** 管理端保存时，脱敏占位符表示「保持原值」。纯函数，便于测试。 */
export function mergeMaskedSecrets(next: SeoSettings, current: SeoSettings): SeoSettings {
  return {
    ...next,
    baidu: {
      ...next.baidu,
      token: next.baidu.token === SECRET_MASK ? current.baidu.token : next.baidu.token,
    },
    ai: {
      ...next.ai,
      apiKey: next.ai.apiKey === SECRET_MASK ? current.ai.apiKey : next.ai.apiKey,
    },
  };
}

export async function saveSeoSettings(input: unknown): Promise<SeoSettings> {
  const parsed = seoSettingsSchema.parse(input);
  const current = await getSeoSettings();
  const value = mergeMaskedSecrets(parsed, current);
  await db
    .insert(t.settings)
    .values({ key: SEO_KEY, value: value as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: t.settings.key,
      set: { value: value as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}
