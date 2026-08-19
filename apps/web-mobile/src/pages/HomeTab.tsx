import * as React from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cn } from '@videox/ui';
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

export function HomeTab() {
  const [feed, setFeed] = React.useState<(typeof FEEDS)[number]['key']>('recommend');
  const user = useAuthStore((s) => s.user);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: contentApi.categories,
    staleTime: 10 * 60_000,
  });

  const query = useInfiniteQuery({
    queryKey: ['home', feed],
    queryFn: ({ pageParam }) =>
      contentApi.videos({ page: pageParam, pageSize: 20, sort: feed === 'recommend' ? 'recommended' : feed }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const videos = flatten(query.data?.pages);

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
      <header className="pt-safe sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-lg">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <h1 className="text-[20px] font-semibold tracking-tight">videoX</h1>
          <div className="flex-1" />
          <Link
            to="/search"
            aria-label="搜索"
            className="no-tap-highlight grid size-10 place-items-center rounded-full active:bg-accent"
          >
            <Search className="size-5" />
          </Link>
          <Link
            to={user ? '/mine' : '/login'}
            aria-label="我的"
            className="no-tap-highlight size-8 overflow-hidden rounded-full bg-muted"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-[11px] text-muted-foreground">
                {(user?.displayName ?? '我').slice(0, 1)}
              </span>
            )}
          </Link>
        </div>
        <div className="flex items-end gap-6 overflow-x-auto px-4 pt-2 pb-3.5 scrollbar-none">
          {FEEDS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFeed(item.key)}
              className={cn(
                'no-tap-highlight shrink-0 pb-1 text-[15px] transition-colors duration-150',
                feed === item.key ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
              {feed === item.key ? (
                <span className="mx-auto mt-1.5 block h-0.5 w-5 rounded-full bg-foreground" />
              ) : (
                <span className="mt-1.5 block h-0.5" />
              )}
            </button>
          ))}
          {(categories ?? []).slice(0, 8).map((category) => (
            <Link
              key={category.id}
              to={`/category/${category.slug}`}
              className="no-tap-highlight shrink-0 pb-1 text-[15px] text-muted-foreground"
            >
              {category.name}
              <span className="mt-1.5 block h-0.5" />
            </Link>
          ))}
        </div>
      </header>

      <PullToRefresh onRefresh={() => query.refetch()}>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-6 px-3 pt-4 pb-4">
          {query.isLoading
            ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-xl bg-muted">
                  <div className="aspect-square" />
                  <div className="h-10" />
                </div>
              ))
            : videos.map((video) => <MobileVideoCard key={video.id} video={video} aspect="1 / 1" />)}
        </div>
        <div ref={sentinelRef} className="h-8" />
      </PullToRefresh>
    </>
  );
}
