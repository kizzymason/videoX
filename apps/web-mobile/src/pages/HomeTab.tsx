import * as React from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { BrowseModeToggle, ListLoadingBar, ListPager, cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { useBrowsableList } from '../lib/query';
import { useSeo } from '../hooks/use-seo';
import { useSite, useSiteName } from '../hooks/use-site';
import { PullToRefresh } from '../components/PullToRefresh';
import { MobileVideoCard } from '../components/MobileVideoCard';

const FEEDS = [
  { key: 'recommend', label: '推荐' },
  { key: 'latest', label: '最新' },
  { key: 'popular', label: '热门' },
] as const;

/** 首页 tab 只留三档。分类去搜索页。 */
export function HomeTab() {
  const [feed, setFeed] = React.useState<(typeof FEEDS)[number]['key']>('recommend');
  const siteName = useSiteName();
  const { data: site } = useSite();
  useSeo(
    site
      ? {
          description: site.homeDescription || site.siteDescription,
          keywords: site.homeKeywords || site.siteKeywords,
          canonical: `${window.location.origin}/`,
        }
      : undefined,
  );
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLElement | null>(null);
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const [underline, setUnderline] = React.useState({ left: 0, width: 20 });

  const query = useBrowsableList(
    ['home', feed],
    (page, pageSize) =>
      contentApi.videos({ page, pageSize, sort: feed === 'recommend' ? 'recommended' : feed }),
    { urlPage: false },
  );

  const videos = query.items;
  const showSkeleton = query.loading && videos.length === 0;

  React.useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    setUnderline({ left: active.offsetLeft + (active.offsetWidth - 20) / 2, width: 20 });
  }, [feed]);

  React.useEffect(() => {
    if (query.mode !== 'infinite') return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.mode, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  // 换页签时把列表滚回顶部：紧跟在 header 后面的就是滚动容器（PullToRefresh）。
  const switchFeed = (key: (typeof FEEDS)[number]['key']) => {
    if (key === feed) return;
    setFeed(key);
    query.setPage(1);
    const scroller = headerRef.current?.nextElementSibling;
    if (scroller instanceof HTMLElement) scroller.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <header ref={headerRef} className="pt-safe sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <h1 className="text-[20px] font-semibold tracking-tight">{siteName}</h1>
          <div className="flex-1" />
          <Link
            to="/search"
            aria-label="搜索"
            className="vx-press no-tap-highlight grid size-10 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
          >
            <Search className="size-5" />
          </Link>
          <BrowseModeToggle
            siteDefault={site?.defaultBrowseMode ?? 'paged'}
            className="vx-press no-tap-highlight size-10 rounded-full"
          />
        </div>
        <div ref={tabsRef} className="relative flex items-end gap-6 overflow-x-auto px-4 pt-2 pb-3.5 scrollbar-none">
          {FEEDS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-active={feed === item.key}
              onClick={() => switchFeed(item.key)}
              className={cn(
                'vx-press no-tap-highlight shrink-0 pb-1 text-[15px] transition-colors duration-200',
                feed === item.key ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-3.5 h-0.5 rounded-full bg-foreground transition-[left,width] duration-200 ease-out-quint"
            style={{ left: underline.left, width: underline.width }}
          />
        </div>
      </header>

      <PullToRefresh onRefresh={() => query.refetch()}>
        <ListLoadingBar active={showSkeleton || query.fetching} className="mx-3 mt-2 w-auto" />
        <div
          key={`${query.transitionKey}:${showSkeleton ? 'skeleton' : 'data'}`}
          className="vx-list-enter grid grid-cols-2 gap-x-2.5 gap-y-6 px-3 pt-2.5 pb-4"
        >
          {showSkeleton
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-xl bg-muted">
                  <div className="aspect-[3/2]" />
                  <div className="h-10" />
                </div>
              ))
            : videos.map((video) => <MobileVideoCard key={video.id} video={video} aspect="3 / 2" />)}
        </div>
        {query.mode === 'paged' ? (
          <ListPager
            className="px-3"
            meta={query.meta}
            page={query.page}
            onChange={query.setPage}
            busy={query.fetching}
          />
        ) : (
          <div ref={sentinelRef} className="h-8" />
        )}
      </PullToRefresh>
    </>
  );
}
