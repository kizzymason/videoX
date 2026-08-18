import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { watchPercent } from '@videox/shared';
import { contentApi, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';
import { HeroCarousel } from '../components/HeroCarousel';
import { VideoGrid } from '../components/video/VideoGrid';
import { VideoCard, VideoCardSkeleton } from '../components/video/VideoCard';
import { InfiniteFooter } from '../components/InfiniteFooter';
import { PageContainer, SectionHeader } from '../components/Page';

export function HomePage() {
  const user = useAuthStore((s) => s.user);

  const { data: banners } = useQuery({ queryKey: ['banners'], queryFn: contentApi.banners, staleTime: 5 * 60_000 });

  const { data: continueWatching } = useQuery({
    queryKey: ['continue-watching'],
    queryFn: () => socialApi.continueWatching(8),
    enabled: Boolean(user),
  });

  const { data: recommended, isLoading: recommendLoading } = useQuery({
    queryKey: ['recommend-feed'],
    queryFn: () => contentApi.recommend({ limit: 12 }),
    staleTime: 2 * 60_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['home-feed'],
    queryFn: ({ pageParam }) => contentApi.videos({ page: pageParam, pageSize: 24, sort: 'latest' }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const videos = flatten(feed.data?.pages);

  return (
    <PageContainer>
      {banners && banners.length > 0 ? <HeroCarousel banners={banners} /> : null}

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

      <section className="space-y-4">
        <SectionHeader
          title={user ? '为你推荐' : '热门推荐'}
          description={user ? '根据你的观看偏好实时计算' : '全站近期最受欢迎的内容'}
          action={<Link to="/explore">更多</Link>}
        />
        {recommendLoading ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <VideoCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {(recommended ?? []).slice(0, 12).map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader title="最新发布" />
        <VideoGrid videos={videos} loading={feed.isLoading} loadingMore={feed.isFetchingNextPage} />
        <InfiniteFooter
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          fetchNextPage={() => void feed.fetchNextPage()}
          empty={videos.length === 0 && !feed.isLoading}
        />
      </section>
    </PageContainer>
  );
}