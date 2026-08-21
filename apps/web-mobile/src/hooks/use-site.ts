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
