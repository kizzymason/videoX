import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Spinner, cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';
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
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const [underline, setUnderline] = React.useState({ left: 0, width: 20 });

  const query = useInfiniteQuery({
    queryKey: ['home', feed],
    queryFn: ({ pageParam }) =>
      contentApi.videos({ page: pageParam, pageSize: 20, sort: feed === 'recommend' ? 'recommended' : feed }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    placeholderData: keepPreviousData,
  });

  const videos = flatten(query.data?.pages);
  const showSkeleton = query.isLoading && videos.length === 0;
  const fetching = query.isFetching && !query.isFetchingNextPage && videos.length > 0;

  React.useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    setUnderline({ left: active.offsetLeft + (active.offsetWidth - 20) / 2, width: 20 });
  }, [feed]);

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return (
    <>
      <header className="pt-safe sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <h1 className="text-[20px] font-semibold tracking-tight">videoX</h1>
          <div className="flex-1" />
          <Link
            to="/search"
            aria-label="搜索"
            className="vx-press no-tap-highlight grid size-10 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
          >
            <Search className="size-5" />
          </Link>
          {initializing ? (
            <span className="size-8 animate-pulse rounded-full bg-muted" />
          ) : (
            <Link
              to={user ? '/mine' : '/login'}
              aria-label="我的"
              className="vx-press no-tap-highlight size-8 overflow-hidden rounded-full bg-muted"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-[11px] text-muted-foreground">
                  {(user?.displayName ?? '我').slice(0, 1)}
                </span>
              )}
            </Link>
          )}
        </div>
        <div ref={tabsRef} className="relative flex items-end gap-6 overflow-x-auto px-4 pt-2 pb-3.5 scrollbar-none">
          {FEEDS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-active={feed === item.key}
              onClick={() => setFeed(item.key)}
              className={cn(
                'no-tap-highlight shrink-0 pb-1 text-[15px] transition-colors duration-200',
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
        <div className="relative grid grid-cols-2 gap-x-2.5 gap-y-6 px-3 pt-4 pb-4">
          {showSkeleton
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-xl bg-muted">
                  <div className="aspect-[3/2]" />
                  <div className="h-10" />
                </div>
              ))
            : videos.map((video) => <MobileVideoCard key={video.id} video={video} aspect="3 / 2" />)}
          {fetching ? (
            <div className="pointer-events-none absolute top-4 right-3">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : null}
        </div>
        <div ref={sentinelRef} className="h-8" />
      </PullToRefresh>
    </>
  );
}
