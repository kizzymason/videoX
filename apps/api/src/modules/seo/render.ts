// ========================================================================
// SEO 系统 - 爬虫动态渲染
//
// 前台是纯 SPA，首包 HTML 里没有内容，百度等不执行 JS 的爬虫抓不到东西。
// nginx 检测到搜索引擎 UA 时把页面请求改写到 /__seo/render{path}，
// 这里直出一份带完整 meta / OG / JSON-LD / 正文链接的语义化 HTML。
// 真实用户仍走 SPA，互不影响。
// ========================================================================

import { sql as dsql } from 'drizzle-orm';
import { sqlRows } from '../../core/db.js';
import { env } from '../../config/env.js';
import { getSiteSettings } from '../settings/service.js';
import { getSeoSettings } from './settings.js';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 封面可能是相对路径也可能是采集来的绝对 URL，统一成绝对地址。 */
export function absoluteUrl(pathOrUrl: string | null, origin: string): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export function isoDuration(seconds: number): string {
  const total = Math.max(1, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}${s}S`;
}

export interface SeoPageData {
  title: string;
  description: string;
  keywords: string;
  canonical: string;
  /** 当前请求 URL（移动端可能与 canonical 不同） */
  pageUrl: string;
  ogType: 'website' | 'video.other' | 'article';
  image: string | null;
  robots: 'index,follow' | 'noindex,follow';
  jsonLd: Record<string, unknown>[];
  siteName: string;
  h1: string;
  /** 已转义好的正文 HTML 片段 */
  contentHtml: string;
}

/** 组装完整 HTML 文档。所有动态字段在此前必须已转义。 */
export function buildHtmlDocument(page: SeoPageData): string {
  const jsonLdScripts = page.jsonLd
    .map((item) => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, '\\u003c')}</script>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
${page.keywords ? `<meta name="keywords" content="${escapeHtml(page.keywords)}" />` : ''}
<meta name="robots" content="${page.robots}" />
<link rel="canonical" href="${escapeHtml(page.canonical)}" />
<meta property="og:site_name" content="${escapeHtml(page.siteName)}" />
<meta property="og:type" content="${page.ogType}" />
<meta property="og:title" content="${escapeHtml(page.title)}" />
<meta property="og:description" content="${escapeHtml(page.description)}" />
<meta property="og:url" content="${escapeHtml(page.pageUrl)}" />
${page.image ? `<meta property="og:image" content="${escapeHtml(page.image)}" />` : ''}
<meta name="twitter:card" content="${page.image ? 'summary_large_image' : 'summary'}" />
<meta name="twitter:title" content="${escapeHtml(page.title)}" />
<meta name="twitter:description" content="${escapeHtml(page.description)}" />
${page.image ? `<meta name="twitter:image" content="${escapeHtml(page.image)}" />` : ''}
${jsonLdScripts}
</head>
<body>
<header><a href="/">${escapeHtml(page.siteName)}</a></header>
<main>
<h1>${escapeHtml(page.h1)}</h1>
${page.contentHtml}
</main>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// 各页面的数据装配
// --------------------------------------------------------------------------

interface VideoRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  duration_seconds: number;
  published_at: string | Date | null;
  updated_at: string | Date;
  view_count: number;
  like_count: number;
  author_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[] | null;
}

function videoLinkList(rows: Array<{ slug: string; title: string }>, origin: string): string {
  if (rows.length === 0) return '';
  const items = rows
    .map((v) => `<li><a href="${escapeHtml(`${origin}/watch/${v.slug}`)}">${escapeHtml(v.title)}</a></li>`)
    .join('\n');
  return `<ul>\n${items}\n</ul>`;
}

async function latestVideos(limit: number, categoryId?: string): Promise<Array<{ slug: string; title: string }>> {
  return sqlRows<{ slug: string; title: string }>(dsql`
    SELECT slug, title FROM videos
    WHERE status IN ('ready','partially_ready') AND visibility = 'public'
      ${categoryId ? dsql`AND category_id = ${categoryId}` : dsql``}
    ORDER BY coalesce(published_at, created_at) DESC
    LIMIT ${limit}
  `);
}

export async function buildHomePage(origin: string, pageUrl: string): Promise<SeoPageData> {
  const [site, seo, videos, categories] = await Promise.all([
    getSiteSettings(),
    getSeoSettings(),
    latestVideos(30),
    sqlRows<{ slug: string; name: string }>(dsql`
      SELECT slug, name FROM categories WHERE is_active = true ORDER BY sort_order
    `),
  ]);

  const description = seo.pages.homeDescription || site.siteDescription || site.siteTagline || site.siteName;
  const keywords = seo.pages.homeKeywords || site.siteKeywords;
  const categoryLinks = categories
    .map((c) => `<li><a href="${escapeHtml(`${origin}/category/${c.slug}`)}">${escapeHtml(c.name)}</a></li>`)
    .join('\n');

  return {
    title: site.siteTagline ? `${site.siteName} - ${site.siteTagline}` : site.siteName,
    description,
    keywords,
    canonical: origin,
    pageUrl,
    ogType: 'website',
    image: absoluteUrl(site.logoUrl, origin),
    robots: 'index,follow',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.siteName,
        url: origin,
        description,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${origin}/search?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
    ],
    siteName: site.siteName,
    h1: site.siteName,
    contentHtml: `<p>${escapeHtml(description)}</p>\n<h2>频道</h2>\n<ul>\n${categoryLinks}\n</ul>\n<h2>最新视频</h2>\n${videoLinkList(videos, origin)}`,
  };
}

export async function buildWatchPage(slug: string, origin: string, pageUrl: string): Promise<SeoPageData | null> {
  const rows = await sqlRows<VideoRow>(dsql`
    SELECT v.id, v.slug, v.title, v.description, v.poster_url, v.duration_seconds,
           v.published_at, v.updated_at, v.view_count, v.like_count,
           u.display_name AS author_name,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           vs.seo_title, vs.seo_description, vs.keywords AS seo_keywords
    FROM videos v
    LEFT JOIN users u ON u.id = v.author_id
    LEFT JOIN categories c ON c.id = v.category_id
    LEFT JOIN video_seo vs ON vs.video_id = v.id
    WHERE v.slug = ${slug} AND v.status IN ('ready','partially_ready') AND v.visibility = 'public'
    LIMIT 1
  `);
  const video = rows[0];
  if (!video) return null;

  const site = await getSiteSettings();
  const canonical = `${origin}/watch/${video.slug}`;
  const displayTitle = video.seo_title || video.title;
  const title = site.seo.videoTitleTemplate
    .replace('{title}', displayTitle)
    .replace('{siteName}', site.siteName);
  const description = (video.seo_description || video.description || `${video.title} - 在线观看`).slice(0, 300);
  const keywords = [
    ...(video.seo_keywords ?? []),
    ...(video.category_name ? [video.category_name] : []),
  ].join(',') || site.siteKeywords;
  const image = absoluteUrl(video.poster_url, origin);
  const uploadDate = (video.published_at ? new Date(video.published_at) : new Date(video.updated_at)).toISOString();

  const related = await latestVideos(12, video.category_id ?? undefined);
  const relatedFiltered = related.filter((r) => r.slug !== video.slug).slice(0, 10);

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: displayTitle,
      description,
      thumbnailUrl: image ? [image] : [],
      uploadDate,
      duration: isoDuration(video.duration_seconds),
      embedUrl: canonical,
      keywords: keywords || undefined,
      publisher: { '@type': 'Organization', name: site.siteName, url: origin },
      ...(video.author_name ? { creator: { '@type': 'Person', name: video.author_name } } : {}),
      interactionStatistic: [
        {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          userInteractionCount: video.view_count,
        },
        {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'LikeAction' },
          userInteractionCount: video.like_count,
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: site.siteName, item: origin },
        ...(video.category_name && video.category_slug
          ? [{ '@type': 'ListItem', position: 2, name: video.category_name, item: `${origin}/category/${video.category_slug}` }]
          : []),
        { '@type': 'ListItem', position: video.category_name ? 3 : 2, name: displayTitle, item: canonical },
      ],
    },
  ];

  const posterHtml = image
    ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(displayTitle)}" width="640" /></p>`
    : '';
  const contentHtml = [
    posterHtml,
    `<p>${escapeHtml(description)}</p>`,
    video.category_name && video.category_slug
      ? `<p>频道：<a href="${escapeHtml(`${origin}/category/${video.category_slug}`)}">${escapeHtml(video.category_name)}</a></p>`
      : '',
    relatedFiltered.length > 0 ? `<h2>相关推荐</h2>\n${videoLinkList(relatedFiltered, origin)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    description,
    keywords,
    canonical,
    pageUrl,
    ogType: 'video.other',
    image,
    robots: 'index,follow',
    jsonLd,
    siteName: site.siteName,
    h1: displayTitle,
    contentHtml,
  };
}

export async function buildCategoryPage(slug: string, origin: string, pageUrl: string): Promise<SeoPageData | null> {
  const rows = await sqlRows<{ id: string; slug: string; name: string; description: string | null }>(dsql`
    SELECT id, slug, name, description FROM categories WHERE slug = ${slug} AND is_active = true LIMIT 1
  `);
  const category = rows[0];
  if (!category) return null;

  const site = await getSiteSettings();
  const videos = await latestVideos(30, category.id);
  const title = site.seo.categoryTitleTemplate
    .replace('{category}', category.name)
    .replace('{siteName}', site.siteName);
  const description = (category.description || `${category.name}频道最新视频在线观看`).slice(0, 300);
  const canonical = `${origin}/category/${category.slug}`;

  return {
    title,
    description,
    keywords: [category.name, site.siteKeywords].filter(Boolean).join(','),
    canonical,
    pageUrl,
    ogType: 'website',
    image: null,
    robots: 'index,follow',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        url: canonical,
        description,
        isPartOf: { '@type': 'WebSite', name: site.siteName, url: origin },
      },
    ],
    siteName: site.siteName,
    h1: category.name,
    contentHtml: `<p>${escapeHtml(description)}</p>\n${videoLinkList(videos, origin)}`,
  };
}

export async function buildCategoriesPage(origin: string, pageUrl: string): Promise<SeoPageData> {
  const site = await getSiteSettings();
  const categories = await sqlRows<{ slug: string; name: string; description: string | null }>(dsql`
    SELECT slug, name, description FROM categories WHERE is_active = true ORDER BY sort_order
  `);
  const links = categories
    .map(
      (c) =>
        `<li><a href="${escapeHtml(`${origin}/category/${c.slug}`)}">${escapeHtml(c.name)}</a>${c.description ? ` - ${escapeHtml(c.description)}` : ''}</li>`,
    )
    .join('\n');

  return {
    title: `全部频道 - ${site.siteName}`,
    description: `${site.siteName}全部视频频道导航`,
    keywords: site.siteKeywords,
    canonical: `${origin}/categories`,
    pageUrl,
    ogType: 'website',
    image: null,
    robots: 'index,follow',
    jsonLd: [],
    siteName: site.siteName,
    h1: '全部频道',
    contentHtml: `<ul>\n${links}\n</ul>`,
  };
}

async function buildSimplePage(
  origin: string,
  pageUrl: string,
  path: string,
  h1: string,
  description: string,
  robots: SeoPageData['robots'] = 'index,follow',
): Promise<SeoPageData> {
  const site = await getSiteSettings();
  const videos = await latestVideos(20);
  return {
    title: `${h1} - ${site.siteName}`,
    description,
    keywords: site.siteKeywords,
    canonical: `${origin}${path}`,
    pageUrl,
    ogType: 'website',
    image: null,
    robots,
    jsonLd: [],
    siteName: site.siteName,
    h1,
    contentHtml: `<p>${escapeHtml(description)}</p>\n${videoLinkList(videos, origin)}`,
  };
}

// --------------------------------------------------------------------------
// 路由分发
// --------------------------------------------------------------------------

export interface RenderOutcome {
  status: number;
  html: string;
}

/** 解析请求路径：/m 前缀代表移动端，canonical 一律指向 PC 版避免重复收录。 */
export function normalizeRenderPath(rawPath: string): { path: string; isMobile: boolean } {
  let path = rawPath.split('?')[0] ?? '/';
  try {
    path = decodeURIComponent(path);
  } catch {
    // 非法编码按原样处理
  }
  if (!path.startsWith('/')) path = `/${path}`;
  const isMobile = path === '/m' || path.startsWith('/m/');
  if (isMobile) path = path.slice(2) || '/';
  path = path.replace(/\/+$/, '') || '/';
  return { path, isMobile };
}

export async function renderForCrawler(rawPath: string): Promise<RenderOutcome> {
  const origin = env.SITE_PUBLIC_URL.replace(/\/+$/, '');
  const { path, isMobile } = normalizeRenderPath(rawPath);
  const pageUrl = isMobile ? `${origin}/m${path === '/' ? '' : path}` : `${origin}${path === '/' ? '' : path}` || origin;

  let page: SeoPageData | null = null;
  let status = 200;

  const watchMatch = /^\/watch\/([^/]+)$/.exec(path);
  const categoryMatch = /^\/category\/([^/]+)$/.exec(path);

  if (path === '/') {
    page = await buildHomePage(origin, pageUrl);
  } else if (watchMatch?.[1]) {
    page = await buildWatchPage(watchMatch[1], origin, pageUrl);
    if (!page) status = 404;
  } else if (categoryMatch?.[1]) {
    page = await buildCategoryPage(categoryMatch[1], origin, pageUrl);
    if (!page) status = 404;
  } else if (path === '/categories') {
    page = await buildCategoriesPage(origin, pageUrl);
  } else if (path === '/shorts') {
    page = await buildSimplePage(origin, pageUrl, '/shorts', 'Shorts 短视频', '竖屏短视频，随刷随看');
  } else if (path === '/search') {
    page = await buildSimplePage(origin, pageUrl, '/search', '搜索', '搜索全站视频');
  } else if (path === '/membership') {
    page = await buildSimplePage(origin, pageUrl, '/membership', '会员中心', '开通会员，解锁全站会员专享内容');
  } else {
    // 未知路径：给爬虫一个可跳出的页面，但不让它进索引。
    page = await buildSimplePage(origin, pageUrl, path, '页面', '返回首页浏览最新内容', 'noindex,follow');
  }

  if (!page) {
    const site = await getSiteSettings();
    return {
      status,
      html: buildHtmlDocument({
        title: `内容不存在 - ${site.siteName}`,
        description: '内容不存在或已下架',
        keywords: '',
        canonical: origin,
        pageUrl,
        ogType: 'website',
        image: null,
        robots: 'noindex,follow',
        jsonLd: [],
        siteName: site.siteName,
        h1: '内容不存在',
        contentHtml: `<p>内容不存在或已下架，<a href="${escapeHtml(origin)}">返回首页</a>。</p>`,
      }),
    };
  }

  return { status, html: buildHtmlDocument(page) };
}
