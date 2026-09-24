import { describe, expect, it } from 'vitest';
import {
  ADMIN_PATH_RESERVED,
  isValidAdminPath,
  normalizeAdminPath,
  siteSettingsSchema,
} from '../packages/shared/src/index.ts';
import { readFileSync } from 'node:fs';

const SAMPLE_PATH = 'k9m2x7q4';

/**
 * 入口路径的形态必须和 deploy/videox-locations.conf 里的正则保持一致：
 * ^/([a-z](?=[a-z]*[0-9])[a-z0-9]{5,31})(?:/|$)
 * 任何一边放宽，另一边都会漏放或误挡，所以这里把两边的规则一起钉住。
 */
const NGINX_ENTRY_RE = /^\/([a-z](?=[a-z]*[0-9])[a-z0-9]{5,31})(?:\/|$)/;

describe('后台入口路径', () => {
  it('合法路径能被 nginx 的入口正则命中，子路径也一样', () => {
    expect(isValidAdminPath(SAMPLE_PATH)).toBe(true);
    expect(NGINX_ENTRY_RE.exec(`/${SAMPLE_PATH}`)?.[1]).toBe(SAMPLE_PATH);
    expect(NGINX_ENTRY_RE.exec(`/${SAMPLE_PATH}/videos`)?.[1]).toBe(SAMPLE_PATH);
  });

  it('拒绝纯字母、过短、大写与保留词', () => {
    expect(isValidAdminPath('abcdefgh')).toBe(false);
    expect(isValidAdminPath('a1b2')).toBe(false);
    expect(isValidAdminPath('Abc12345')).toBe(false);
    expect(isValidAdminPath('1abc2345')).toBe(false);
    for (const word of ADMIN_PATH_RESERVED) expect(isValidAdminPath(word)).toBe(false);
  });

  it('前台的单段路由不会被 nginx 入口正则误挡', () => {
    for (const path of [
      '/',
      '/explore',
      '/shorts',
      '/categories',
      '/membership',
      '/history',
      '/favorites',
      '/following',
      '/settings',
      '/profile',
      '/search',
      '/watch/some-video-2024',
      '/category/asian',
      '/channel/pandagv',
      '/m/',
      '/assets/index-abc123.js',
      '/sitemap-videos-1.xml',
      '/robots.txt',
    ]) {
      expect(NGINX_ENTRY_RE.test(path), path).toBe(false);
    }
  });

  it('normalize 去掉斜杠与大小写差异', () => {
    expect(normalizeAdminPath(' /Pg7X92K41/ ')).toBe('pg7x92k41');
  });

  it('站点设置里 adminPath 可缺省，但给了就必须合法', () => {
    expect(siteSettingsSchema.parse({ siteName: 'PandaGV' }).adminPath).toBeUndefined();
    expect(() => siteSettingsSchema.parse({ siteName: 'PandaGV', adminPath: 'admin' })).toThrow();
    expect(siteSettingsSchema.parse({ siteName: 'PandaGV', adminPath: '/K9m2x7q4/' }).adminPath).toBe('k9m2x7q4');
  });

  it('shared 包里不能出现兜底入口路径：它会被打进前台的公开 JS', () => {
    const sources = ['constants.ts', 'schemas.ts', 'types.ts'].map((f) =>
      readFileSync(new URL(`../packages/shared/src/${f}`, import.meta.url), 'utf8'),
    );
    for (const source of sources) {
      // 形如 'pg7x92k41' 的字面量：字母开头、含数字、长度够当入口的字符串
      const literals = source.match(/'[a-z][a-z0-9]{5,31}'/g) ?? [];
      const suspicious = literals.filter((raw) => isValidAdminPath(raw.slice(1, -1)));
      expect(suspicious, `shared 里出现了可用作入口的字面量：${suspicious.join(', ')}`).toEqual([]);
    }
  });
});
