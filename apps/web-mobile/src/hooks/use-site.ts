import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { contentApi } from '../lib/api';

export function useSite() {
  return useQuery({
    queryKey: ['site'],
    queryFn: contentApi.site,
    staleTime: 60_000,
  });
}

export function useSiteName(fallback = 'PandaGV'): string {
  const { data } = useSite();
  return data?.siteName?.trim() || fallback;
}

/**
 * 是否展示播放量（后台「功能策略 → 展示播放量」）。
 * 站点设置还没到手时按不展示处理：默认就是关，也避免先闪一下数字再消失。
 */
export function useShowViewCount(): boolean {
  const { data } = useSite();
  return data?.showViewCount === true;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): () => void {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !el;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const previous = el.content;
  el.content = content;
  return () => {
    if (created) el.remove();
    else el.content = previous;
  };
}

function upsertCanonical(href: string): () => void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !el;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  const previous = el.href;
  el.href = href;
  return () => {
    if (created) el.remove();
    else el.href = previous;
  };
}

/** 首页默认 title / description / keywords，与后台 SEO 设置、爬虫渲染同一套。 */
export function useSiteHead(): void {
  const { data: site } = useSite();

  React.useEffect(() => {
    if (!site) return;
    const title = site.homeTitle?.trim() || site.siteName;
    const description = site.homeDescription?.trim() || site.siteDescription;
    const keywords = site.homeKeywords?.trim() || site.siteKeywords;
    const canonical = `${window.location.origin}/`;
    const previousTitle = document.title;
    document.title = title;
    const cleanups = [
      () => {
        document.title = previousTitle;
      },
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:title', title),
      upsertMeta('property', 'og:description', description),
      upsertMeta('property', 'og:url', canonical),
      upsertCanonical(canonical),
    ];
    if (keywords) cleanups.push(upsertMeta('name', 'keywords', keywords));
    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }, [site]);

  React.useEffect(() => {
    if (!site?.faviconUrl) return;
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.getAttribute('href');
    link.setAttribute('href', site.faviconUrl);
    return () => {
      if (previous) link.setAttribute('href', previous);
    };
  }, [site?.faviconUrl]);
}
