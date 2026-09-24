import { describe, expect, it } from 'vitest';
import { seoSettingsSchema } from '../packages/shared/src/schemas.ts';
import type { SeoSettings } from '../packages/shared/src/types.ts';
import {
  SECRET_MASK,
  maskSeoSettings,
  mergeMaskedSecrets,
} from '../apps/api/src/modules/seo/settings.ts';

describe('SEO 设置 schema', () => {
  it('空对象走出完整默认值', () => {
    const settings = seoSettingsSchema.parse({});
    expect(settings.autoPushEnabled).toBe(false);
    expect(settings.pushBatchSize).toBe(200);
    expect(settings.indexNow).toEqual({ enabled: false, key: '' });
    expect(settings.baidu).toEqual({ enabled: false, site: '', token: '' });
    expect(settings.ai.dailyLimit).toBe(300);
    expect(settings.pages.homeTitle).toBe('');
    expect(settings.pages.homeKeywords).toBe('');
  });

  it('拒绝越界的推送批量', () => {
    expect(() => seoSettingsSchema.parse({ pushBatchSize: 999999 })).toThrow();
  });
});

describe('密钥脱敏', () => {
  const full = seoSettingsSchema.parse({
    baidu: { enabled: true, site: 'https://example.com', token: 'real-token' },
    ai: { enabled: true, endpoint: 'https://api.x.com/v1', apiKey: 'sk-real', model: 'gpt' },
  }) as SeoSettings;

  it('读取时隐藏 token 与 apiKey', () => {
    const masked = maskSeoSettings(full);
    expect(masked.baidu.token).toBe(SECRET_MASK);
    expect(masked.ai.apiKey).toBe(SECRET_MASK);
    // 原对象不被修改
    expect(full.baidu.token).toBe('real-token');
  });

  it('保存时脱敏占位符还原为原值', () => {
    const masked = maskSeoSettings(full);
    const merged = mergeMaskedSecrets(masked, full);
    expect(merged.baidu.token).toBe('real-token');
    expect(merged.ai.apiKey).toBe('sk-real');
  });

  it('保存时新密钥覆盖旧值', () => {
    const next = { ...maskSeoSettings(full), baidu: { ...full.baidu, token: 'new-token' } };
    const merged = mergeMaskedSecrets(next, full);
    expect(merged.baidu.token).toBe('new-token');
    expect(merged.ai.apiKey).toBe('sk-real');
  });
});
