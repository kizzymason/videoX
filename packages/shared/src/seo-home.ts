/** 首页 SEO：独立标题优先，描述/关键词回落到站点设置。 */

export interface HomeSeoInput {
  siteName: string;
  siteTagline?: string;
  siteDescription?: string;
  siteKeywords?: string;
  homeTitle?: string;
  homeDescription?: string;
  homeKeywords?: string;
}

export interface HomeSeo {
  title: string;
  description: string;
  keywords: string;
}

export function videoWatchPath(slug: string): string {
  return `/watch/${slug}`;
}

/**
 * 仅给 Google 视频 sitemap 用的独立 URL，必须和播放页不同。
 * 这里不是可播放地址，不带 HLS / playToken，也不走热链。
 */
export function videoEmbedPath(slug: string): string {
  return `/embed/${slug}`;
}

export function resolveHomeSeo(input: HomeSeoInput): HomeSeo {
  const title = input.homeTitle?.trim() || input.siteName;
  const description =
    input.homeDescription?.trim() ||
    input.siteDescription?.trim() ||
    input.siteTagline?.trim() ||
    input.siteName;
  const keywords = input.homeKeywords?.trim() || input.siteKeywords?.trim() || '';
  return { title, description, keywords };
}
