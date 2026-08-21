import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { contentApi } from '../lib/api';

/** 后台「站点设置 → 基础信息」的公开投影。各页共用同一份缓存。 */
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

/** 把站点名称和自定义 favicon 写进标签页，改后台设置后刷新即可看到。 */
export function useSiteHead(): void {
  const { data: site } = useSite();

  React.useEffect(() => {
    if (site?.siteName) document.title = site.siteName;
  }, [site?.siteName]);

  React.useEffect(() => {
    if (!site?.faviconUrl) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previous = link.getAttribute('href');
    link.setAttribute('href', site.faviconUrl);
    return () => {
      if (previous) link.setAttribute('href', previous);
    };
  }, [site?.faviconUrl]);

  React.useEffect(() => {
    if (!site?.siteDescription) return;
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) return;
    const previous = meta.content;
    meta.content = site.siteDescription;
    return () => {
      meta.content = previous;
    };
  }, [site?.siteDescription]);
}
