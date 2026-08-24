import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db, sqlRows } from '../../core/db.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../core/respond.js';
import { cached } from '../../core/redis.js';
import { getSiteSettings } from '../settings/service.js';
import { getSeoSettings } from './settings.js';
import { absoluteUrl, renderForCrawler } from './render.js';

export const seoRouter: Router = Router();

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function siteUrl(path: string): string {
  return `${env.SITE_PUBLIC_URL.replace(/\/+$/, '')}${path}`;
}

/**
 * 爬虫动态渲染入口。nginx 检测到搜索引擎 UA 后把页面请求
 * rewrite 到 /__seo/render{原路径}，这里直出语义化 HTML。
 * 结果短缓存，抵御爬虫突发抓取。
 */
seoRouter.get(
  ['/__seo/render', '/__seo/render/*splat'],
  asyncHandler(async (req, res) => {
    const rawPath = req.originalUrl.replace(/^\/__seo\/render/, '') || '/';
    const key = `seo:render:${rawPath.split('?')[0]}`;
    const outcome = await cached(key, 300, () => renderForCrawler(rawPath));
    res.status(outcome.status).type('html').send(outcome.html);
  }),
);

/**
 * IndexNow 所有权校验文件：https://域名/{key}.txt
 * 搜索引擎会抓取该文件核对 key，必须与推送时使用的 key 一致。
 */
seoRouter.get(
  /^\/([a-zA-Z0-9-]{8,128})\.txt$/,
  asyncHandler(async (req, res) => {
    const requested = (req.params as Record<string, string>)['0'] ?? '';
    const settings = await getSeoSettings();
    if (!settings.indexNow.key || requested !== settings.indexNow.key) {
      res.status(404).type('text/plain').send('not found');
      return;
    }
    res.type('text/plain').send(settings.indexNow.key);
  }),
);

/**
 * sitemap 索引。视频数量可能很大，按 sitemapPageSize 切成多个子 sitemap，
 * 单个文件保持在搜索引擎推荐的 5 万条 / 50MB 以内。
 */
seoRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const settings = await getSiteSettings();
    if (!settings.seo.sitemapEnabled) {
      res.status(404).type('text/plain').send('sitemap disabled');
      return;
    }

    const xml = await cached('seo:sitemap-index', 600, async () => {
      const [row] = await sqlRows<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM videos
        WHERE status IN ('ready','partially_ready') AND visibility = 'public'
      `);
      const total = Number(row?.total ?? 0);
      const pageSize = settings.seo.sitemapPageSize;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const now = new Date().toISOString();

      const entries = [
        `<sitemap><loc>${escapeXml(siteUrl('/sitemap-pages.xml'))}</loc><lastmod>${now}</lastmod></sitemap>`,
        `<sitemap><loc>${escapeXml(siteUrl('/sitemap-categories.xml'))}</loc><lastmod>${now}</lastmod></sitemap>`,
        ...Array.from(
          { length: pages },
          (_, i) =>
            `<sitemap><loc>${escapeXml(siteUrl(`/sitemap-videos-${i + 1}.xml`))}</loc><lastmod>${now}</lastmod></sitemap>`,
        ),
      ];

      return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>`;
    });

    res.type('application/xml').send(xml);
  }),
);

seoRouter.get(
  '/sitemap-pages.xml',
  asyncHandler(async (_req, res) => {
    const now = new Date().toISOString();
    const paths = ['/', '/categories', '/search', '/membership'];
    const urls = paths.map(
      (p) =>
        `<url><loc>${escapeXml(siteUrl(p))}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>${p === '/' ? '1.0' : '0.7'}</priority></url>`,
    );
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`,
      );
  }),
);

seoRouter.get(
  '/sitemap-categories.xml',
  asyncHandler(async (_req, res) => {
    const xml = await cached('seo:sitemap-categories', 3600, async () => {
      const rows = await sqlRows<{ slug: string; updated_at: string | Date }>(sql`
        SELECT slug, updated_at FROM categories WHERE is_active = true ORDER BY sort_order
      `);
      const urls = rows.map(
        (r) =>
          `<url><loc>${escapeXml(siteUrl(`/category/${r.slug}`))}</loc><lastmod>${new Date(r.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
      );
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
    });
    res.type('application/xml').send(xml);
  }),
);

/** 视频分页 sitemap，附带 video 扩展标签，利于视频结果收录。 */
seoRouter.get(
  '/sitemap-videos-:page.xml',
  asyncHandler(async (req, res) => {
    const settings = await getSiteSettings();
    const page = Math.max(1, Number(req.params.page ?? 1));
    const pageSize = settings.seo.sitemapPageSize;

    const xml = await cached(`seo:sitemap-videos:${page}`, 1800, async () => {
      const rows = await sqlRows<{
        slug: string;
        title: string;
        description: string | null;
        poster_url: string | null;
        duration_seconds: number;
        published_at: string | Date | null;
        updated_at: string | Date;
        view_count: number;
        seo_title: string | null;
        seo_description: string | null;
        seo_keywords: string[] | null;
      }>(sql`
        SELECT v.slug, v.title, v.description, v.poster_url, v.duration_seconds,
               v.published_at, v.updated_at, v.view_count,
               vs.seo_title, vs.seo_description, vs.keywords AS seo_keywords
        FROM videos v
        LEFT JOIN video_seo vs ON vs.video_id = v.id
        WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
        ORDER BY coalesce(v.published_at, v.created_at) DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `);

      const origin = env.SITE_PUBLIC_URL.replace(/\/+$/, '');
      const urls = rows.map((r) => {
        const loc = siteUrl(`/watch/${r.slug}`);
        // sitemap 与页面 meta 使用同一份 SEO 数据，元数据一致是富媒体结果的前提。
        const title = r.seo_title ?? r.title;
        const description = (r.seo_description ?? r.description ?? r.title).slice(0, 2000);
        const thumb = absoluteUrl(r.poster_url, origin) ?? '';
        const tags = (r.seo_keywords ?? [])
          .slice(0, 32)
          .map((k) => `<video:tag>${escapeXml(k)}</video:tag>`)
          .join('');
        return [
          '<url>',
          `<loc>${escapeXml(loc)}</loc>`,
          `<lastmod>${new Date(r.updated_at).toISOString()}</lastmod>`,
          '<changefreq>weekly</changefreq>',
          '<priority>0.9</priority>',
          '<video:video>',
          thumb ? `<video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>` : '',
          `<video:title>${escapeXml(title)}</video:title>`,
          `<video:description>${escapeXml(description)}</video:description>`,
          `<video:player_loc>${escapeXml(loc)}</video:player_loc>`,
          `<video:duration>${Math.max(1, r.duration_seconds)}</video:duration>`,
          r.published_at
            ? `<video:publication_date>${new Date(r.published_at).toISOString()}</video:publication_date>`
            : '',
          `<video:view_count>${r.view_count}</video:view_count>`,
          tags,
          '</video:video>',
          '</url>',
        ]
          .filter(Boolean)
          .join('');
      });

      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${urls.join('\n')}\n</urlset>`;
    });

    res.type('application/xml').send(xml);
  }),
);

seoRouter.get(
  '/robots.txt',
  asyncHandler(async (_req, res) => {
    const settings = await getSiteSettings();
    const lines = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /media/hls/',
      'Disallow: /settings',
      'Disallow: /history',
      '',
    ];
    if (settings.seo.sitemapEnabled) lines.push(`Sitemap: ${siteUrl('/sitemap.xml')}`, '');
    if (settings.seo.robotsExtra.trim()) lines.push(settings.seo.robotsExtra.trim(), '');

    res.type('text/plain').send(lines.join('\n'));
  }),
);

/**
 * 给爬虫用的结构化元数据。前端在播放页把它注入 <head>，
 * 同时 SSR 中间件也会读取这份数据渲染给不执行 JS 的爬虫。
 */
seoRouter.get(
  '/api/seo/video/:slug',
  asyncHandler(async (req, res) => {
    const settings = await getSiteSettings();
    const rows = await sqlRows<{
      id: string;
      slug: string;
      title: string;
      description: string | null;
      poster_url: string | null;
      duration_seconds: number;
      published_at: string | Date | null;
      view_count: number;
      like_count: number;
      author_name: string | null;
      category_name: string | null;
      seo_title: string | null;
      seo_description: string | null;
      seo_keywords: string[] | null;
    }>(sql`
      SELECT v.id, v.slug, v.title, v.description, v.poster_url, v.duration_seconds,
             v.published_at, v.view_count, v.like_count,
             u.display_name AS author_name, c.name AS category_name,
             vs.seo_title, vs.seo_description, vs.keywords AS seo_keywords
      FROM videos v
      LEFT JOIN users u ON u.id = v.author_id
      LEFT JOIN categories c ON c.id = v.category_id
      LEFT JOIN video_seo vs ON vs.video_id = v.id
      WHERE v.slug = ${req.params.slug} AND v.status IN ('ready','partially_ready') AND v.visibility = 'public'
      LIMIT 1
    `);

    const video = rows[0];
    if (!video) {
      res.status(404).json({ code: 1002, message: '视频不存在', data: null, traceId: req.traceId });
      return;
    }

    const origin = env.SITE_PUBLIC_URL.replace(/\/+$/, '');
    const displayTitle = video.seo_title ?? video.title;
    const title = settings.seo.videoTitleTemplate
      .replace('{title}', displayTitle)
      .replace('{siteName}', settings.siteName);
    const description = (video.seo_description ?? video.description ?? settings.siteDescription).slice(0, 300);
    const keywords =
      [...(video.seo_keywords ?? []), ...(video.category_name ? [video.category_name] : [])].join(',') ||
      settings.siteKeywords;
    const image = absoluteUrl(video.poster_url, origin);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: displayTitle,
      description: description.slice(0, 500),
      thumbnailUrl: image ? [image] : [],
      uploadDate: (video.published_at ? new Date(video.published_at) : new Date()).toISOString(),
      // ISO 8601 时长格式
      duration: `PT${Math.floor(video.duration_seconds / 60)}M${video.duration_seconds % 60}S`,
      embedUrl: siteUrl(`/watch/${video.slug}`),
      keywords: keywords || undefined,
      publisher: { '@type': 'Organization', name: settings.siteName },
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
    };

    res.json({
      code: 0,
      message: 'ok',
      traceId: req.traceId,
      data: {
        title,
        description: description.slice(0, 200),
        keywords,
        image,
        canonical: siteUrl(`/watch/${video.slug}`),
        jsonLd,
      },
    });
  }),
);
