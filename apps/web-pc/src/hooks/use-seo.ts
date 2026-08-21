import * as React from 'react';

export interface SeoInput {
  title?: string;
  description?: string;
  image?: string;
  jsonLd?: Record<string, unknown>;
}

const JSON_LD_ID = 'videox-jsonld';

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): () => void {
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
    if (created) el?.remove();
    else if (el) el.content = previous;
  };
}

/**
 * 客户端 SEO。爬虫拿到的 meta 由后端的注入中间件负责，这里只是让浏览器
 * 分享卡片与标签页标题跟着路由走。
 */
export function useSeo(input: SeoInput | undefined): void {
  const serialized = JSON.stringify(input ?? {});

  React.useEffect(() => {
    const seo = JSON.parse(serialized) as SeoInput;
    const cleanups: Array<() => void> = [];

    if (seo.title) {
      const previous = document.title;
      document.title = `${seo.title} - PandaGV`;
      cleanups.push(() => {
        document.title = previous;
      });
      cleanups.push(setMeta('meta[property="og:title"]', 'property', 'og:title', seo.title));
    }
    if (seo.description) {
      cleanups.push(setMeta('meta[name="description"]', 'name', 'description', seo.description));
      cleanups.push(setMeta('meta[property="og:description"]', 'property', 'og:description', seo.description));
    }
    if (seo.image) {
      cleanups.push(setMeta('meta[property="og:image"]', 'property', 'og:image', seo.image));
    }

    if (seo.jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = JSON_LD_ID;
      script.textContent = JSON.stringify(seo.jsonLd);
      document.head.appendChild(script);
      cleanups.push(() => script.remove());
    }

    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }, [serialized]);
}
