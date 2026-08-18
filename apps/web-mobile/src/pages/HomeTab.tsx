import * as React from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Flame, Sparkles } from 'lucide-react';
import { cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { AppHeader } from '../components/AppHeader';
import { PullToRefresh } from '../components/PullToRefresh';
import { MasonryFeed } from '../components/MasonryFeed';
import { ImmersiveFeed } from '../components/ImmersiveFeed';

const FEEDS = [
  { key: 'recommend', label: '推荐' },
  { key: 'latest', label: '最新' },
  { key: 'popular', label: '最热' },
] as const;

export function HomeTab() {
  const [feed, setFeed] = React.useState<(typeof FEEDS)[number]['key']>('recommend');
  const [immersive, setImmersive] = React.useState(false);

  const { data: banners } = useQuery({ queryKey: ['banners'], queryFn: contentApi.banners, staleTime: 5 * 60_000 });
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

  if (immersive) return <ImmersiveFeed onExit={() => setImmersive(false)} />;

  return (
    <>
      <AppHeader
        showSearch
        title={
          <div className="flex flex-1 items-center gap-1 overflow-x-auto px-1 scrollbar-none">
            {FEEDS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFeed(item.key)}
                className={cn(
                  'no-tap-highlight shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors',
                  feed === item.key ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
        right={
          <button
            type="button"
            aria-label="沉浸模式"
            onClick={() => setImmersive(true)}
            className="no-tap-highlight grid size-9 place-items-center rounded-full active:bg-accent"
          >
            <Flame className="size-5" />
          </button>
        }
      />

      <PullToRefresh onRefresh={() => query.refetch()}>
        <MasonryFeed
          videos={videos}
          loading={query.isLoading}
          loadingMore={query.isFetchingNextPage}
          hasMore={query.hasNextPage}
          onEndReached={() => void query.fetchNextPage()}
          header={
            <div className="space-y-4 pt-3 pb-4">
              {banners && banners.length > 0 ? <BannerStrip banners={banners} /> : null}
              {categories && categories.length > 0 ? (
                <div className="-mx-3 flex gap-2 overflow-x-auto px-3 scrollbar-none">
                  {categories.slice(0, 14).map((category) => (
                    <Link
                      key={category.id}
                      to={`/category/${category.slug}`}
                      className="no-tap-highlight shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
                    >
                      {category.name}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          }
        />
      </PullToRefresh>
    </>
  );
}

function BannerStrip({ banners }: { banners: { id: string; title: string; imageUrl: string; mobileImageUrl: string | null; videoId: string | null; linkUrl: string | null }[] }) {
  return (
    <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 scrollbar-none">
      {banners.map((banner) => (
        <Link
          key={banner.id}
          to={banner.videoId ? `/watch/${banner.videoId}` : (banner.linkUrl ?? '/')}
          className="relative aspect-[2/1] w-[85%] shrink-0 snap-start overflow-hidden rounded-2xl bg-muted"
        >
          <img
            src={banner.mobileImageUrl ?? banner.imageUrl}
            alt={banner.title}
            className="size-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-white">
              <Sparkles className="size-3.5" />
              {banner.title}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
