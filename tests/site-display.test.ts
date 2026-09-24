import { describe, expect, it } from 'vitest';
import { siteSettingsSchema } from '../packages/shared/src/index.ts';

describe('站点展示开关', () => {
  it('播放量默认不展示', () => {
    expect(siteSettingsSchema.parse({ siteName: 'PandaGV' }).showViewCount).toBe(false);
  });

  it('后台打开后如实保存', () => {
    expect(siteSettingsSchema.parse({ siteName: 'PandaGV', showViewCount: true }).showViewCount).toBe(true);
  });

  it('旧配置缺字段也能解析出完整设置（不会因为新增开关报错）', () => {
    const legacy = { siteName: 'PandaGV', defaultTheme: 'dark', allowRegistration: false };
    const parsed = siteSettingsSchema.parse(legacy);
    expect(parsed.showViewCount).toBe(false);
    expect(parsed.defaultTheme).toBe('dark');
    expect(parsed.allowRegistration).toBe(false);
  });
});
