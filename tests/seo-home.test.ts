import { describe, expect, it } from 'vitest';
import { resolveHomeSeo, videoEmbedPath, videoWatchPath } from '../packages/shared/src/seo-home.ts';

describe('resolveHomeSeo', () => {
  it('独立首页标题优先，不再拼接副标题', () => {
    const home = resolveHomeSeo({
      siteName: 'PandaGV',
      siteTagline: 'PandaGV-旧副标题',
      siteDescription: '旧站点描述',
      siteKeywords: '旧词',
      homeTitle: 'PandaGV - Gay Videos & GV 男同视频',
      homeDescription: '人话描述',
      homeKeywords: 'gay videos, GV',
    });
    expect(home.title).toBe('PandaGV - Gay Videos & GV 男同视频');
    expect(home.description).toBe('人话描述');
    expect(home.keywords).toBe('gay videos, GV');
  });

  it('标题留空回落到站点名，而不是 站点名 - 副标题', () => {
    const home = resolveHomeSeo({
      siteName: 'PandaGV',
      siteTagline: '副标题',
      homeTitle: '  ',
    });
    expect(home.title).toBe('PandaGV');
  });

  it('描述按 首页描述 > 站点描述 > 副标题 > 站点名', () => {
    expect(resolveHomeSeo({ siteName: 'A', siteTagline: 'B' }).description).toBe('B');
    expect(resolveHomeSeo({ siteName: 'A', siteDescription: 'C' }).description).toBe('C');
    expect(resolveHomeSeo({ siteName: 'A' }).description).toBe('A');
  });
});

describe('视频 sitemap 地址', () => {
  it('player_loc 与播放页 loc 不是同一个 URL', () => {
    expect(videoWatchPath('demo-slug')).toBe('/watch/demo-slug');
    expect(videoEmbedPath('demo-slug')).toBe('/embed/demo-slug');
    expect(videoEmbedPath('demo-slug')).not.toBe(videoWatchPath('demo-slug'));
  });

  it('不包含流地址或 token 参数', () => {
    const player = videoEmbedPath('demo-slug');
    expect(player).not.toMatch(/hls|m3u8|playToken|token=/i);
  });
});
