import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { watchPercent, type SortOption } from '@videox/shared';
import { contentApi, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';
import { HeroCarousel } from '../components/HeroCarousel';
import { VideoGrid } from '../components/video/VideoGrid';
import { VideoCard } from '../components/video/VideoCard';
import { InfiniteFooter } from '../components/InfiniteFooter';
import { PageContainer, PageHeader, SectionHeader } from '../components/Page';
import { SortTabs } from '../components/SortTabs';

const HOME_SORTS: SortOption[] = ['recommended', 'latest', 'popular', 'most_liked'];

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const [sort, setSort] = React.useState<SortOption>('recommended');

  const { data: banners } = useQuery({ queryKey: ['banners'], queryFn: contentApi.banners, staleTime: 5 * 60_000 });

  const { data: continueWatching } = useQuery({
    queryKey: ['continue-watching'],
    queryFn: () => socialApi.continueWatching(8),
    enabled: Boolean(user),
  });

  const feed = useInfiniteQuery({
    queryKey: ['home-feed', sort],
    queryFn: ({ pageParam }) => contentApi.videos({ page: pageParam, pageSize: 24, sort }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    placeholderData: keepPreviousData,
  });

  const videos = flatten(feed.data?.pages);

  return (
    <PageContainer className="space-y-6">
      {banners && banners.length > 0 ? <HeroCarousel banners={banners} /> : null}

      <PageHeader title="首页" />
      <SortTabs value={sort} onChange={setSort} options={HOME_SORTS} />

      {continueWatching && continueWatching.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader title="继续观看" action={<Link to="/history">全部历史</Link>} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
            {continueWatching.map((item) => (
              <VideoCard
                key={item.id}
                video={item.video}
                progressPercent={watchPercent(item.positionSeconds, item.durationSeconds)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <VideoGrid
        videos={videos}
        loading={feed.isLoading}
        loadingMore={feed.isFetchingNextPage}
        fetching={feed.isFetching && !feed.isFetchingNextPage && videos.length > 0}
        className="xl:grid-cols-4 2xl:grid-cols-4 min-[1800px]:grid-cols-4"
      />
      <InfiniteFooter
        hasNextPage={feed.hasNextPage}
        isFetchingNextPage={feed.isFetchingNextPage}
        fetchNextPage={() => void feed.fetchNextPage()}
        empty={videos.length === 0 && !feed.isLoading}
      />
    </PageContainer>
  );
}
