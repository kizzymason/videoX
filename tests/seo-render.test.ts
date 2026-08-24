import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  buildHtmlDocument,
  escapeHtml,
  isoDuration,
  normalizeRenderPath,
  type SeoPageData,
} from '../apps/api/src/modules/seo/render.ts';

describe('渲染工具函数', () => {
  it('HTML 转义', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  it('封面相对路径拼绝对地址，绝对 URL 原样返回', () => {
    expect(absoluteUrl('/static/p.jpg', 'https://example.com')).toBe('https://example.com/static/p.jpg');
    expect(absoluteUrl('https://cdn.other.com/p.jpg', 'https://example.com')).toBe('https://cdn.other.com/p.jpg');
    expect(absoluteUrl(null, 'https://example.com')).toBeNull();
  });

  it('ISO 8601 时长', () => {
    expect(isoDuration(90)).toBe('PT1M30S');
    expect(isoDuration(3700)).toBe('PT1H1M40S');
    expect(isoDuration(0)).toBe('PT1S');
  });
});

describe('渲染路径解析', () => {
  it('区分移动端前缀并还原 PC 路径', () => {
    expect(normalizeRenderPath('/m/watch/abc')).toEqual({ path: '/watch/abc', isMobile: true });
    expect(normalizeRenderPath('/m')).toEqual({ path: '/', isMobile: true });
    expect(normalizeRenderPath('/watch/abc')).toEqual({ path: '/watch/abc', isMobile: false });
    expect(normalizeRenderPath('/')).toEqual({ path: '/', isMobile: false });
  });

  it('去掉查询串与尾部斜杠', () => {
    expect(normalizeRenderPath('/category/movie/?page=2')).toEqual({ path: '/category/movie', isMobile: false });
  });

  it('非法编码不崩溃', () => {
    expect(normalizeRenderPath('/watch/%E4%B8%AD%E6%96%87')).toEqual({ path: '/watch/中文', isMobile: false });
    expect(() => normalizeRenderPath('/watch/%zz')).not.toThrow();
  });
});

describe('HTML 文档组装', () => {
  const page: SeoPageData = {
    title: '标题 <script>',
    description: '描述"引号"',
    keywords: '词1,词2',
    canonical: 'https://example.com/watch/abc',
    pageUrl: 'https://example.com/m/watch/abc',
    ogType: 'video.other',
    image: 'https://example.com/p.jpg',
    robots: 'index,follow',
    jsonLd: [{ '@type': 'VideoObject', name: '</script><img>' }],
    siteName: 'PandaGV',
    h1: '标题',
    contentHtml: '<p>正文</p>',
  };

  it('包含 canonical / keywords / OG / robots', () => {
    const html = buildHtmlDocument(page);
    expect(html).toContain('<link rel="canonical" href="https://example.com/watch/abc" />');
    expect(html).toContain('<meta name="keywords" content="词1,词2" />');
    expect(html).toContain('<meta property="og:type" content="video.other" />');
    expect(html).toContain('<meta property="og:url" content="https://example.com/m/watch/abc" />');
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('标题与描述被转义', () => {
    const html = buildHtmlDocument(page);
    expect(html).toContain('标题 &lt;script&gt;');
    expect(html).not.toContain('<title>标题 <script></title>');
  });

  it('JSON-LD 中的 < 被转义，防止提前闭合 script', () => {
    const html = buildHtmlDocument(page);
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain('</script><img>');
    expect(html).toContain('\\u003c/script>');
  });

  it('无图片时使用 summary 卡片且不输出 og:image', () => {
    const html = buildHtmlDocument({ ...page, image: null });
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).not.toContain('og:image');
  });
});
