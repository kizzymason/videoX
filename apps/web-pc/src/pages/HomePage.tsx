import * as React from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type SortOption } from '@videox/shared';
import { contentApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { HeroCarousel } from '../components/HeroCarousel';
import { VideoGrid } from '../components/video/VideoGrid';
import { InfiniteFooter } from '../components/InfiniteFooter';
import { PageContainer, PageHeader } from '../components/Page';
import { SortTabs } from '../components/SortTabs';

const HOME_SORTS: SortOption[] = ['recommended', 'latest', 'popular', 'most_liked'];

export function HomePage() {
  const [sort, setSort] = React.useState<SortOption>('recommended');

  const { data: banners } = useQuery({ queryKey: ['banners'], queryFn: contentApi.banners, staleTime: 5 * 60_000 });

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
