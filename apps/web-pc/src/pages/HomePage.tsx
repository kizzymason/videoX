import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { parseHomeSort } from '@videox/shared';
import { ListPager } from '@videox/ui';
import { contentApi } from '../lib/api';
import { useBrowsableList } from '../lib/query';
import { useSeo } from '../hooks/use-seo';
import { useSite } from '../hooks/use-site';
import { HeroCarousel } from '../components/HeroCarousel';
import { VideoGrid } from '../components/video/VideoGrid';
import { InfiniteFooter } from '../components/InfiniteFooter';
import { PageContainer } from '../components/Page';

export function HomePage() {
  const [params] = useSearchParams();
  const sort = parseHomeSort(params.get('sort'));
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

  const { data: banners } = useQuery({ queryKey: ['banners'], queryFn: contentApi.banners, staleTime: 5 * 60_000 });

  const feed = useBrowsableList(['home-feed', sort], (page, pageSize) =>
    contentApi.videos({ page, pageSize, sort }),
  );

  return (
    <PageContainer className="space-y-6">
      {banners && banners.length > 0 ? <HeroCarousel banners={banners} /> : null}

      <VideoGrid
        videos={feed.items}
        loading={feed.loading}
        loadingMore={feed.mode === 'infinite' && feed.isFetchingNextPage}
        fetching={feed.fetching}
        transitionKey={feed.transitionKey}
        className="xl:grid-cols-4 2xl:grid-cols-4 min-[1800px]:grid-cols-4"
      />
      {feed.mode === 'paged' ? (
        <ListPager meta={feed.meta} page={feed.page} onChange={feed.setPage} busy={feed.fetching} />
      ) : (
        <InfiniteFooter
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          fetchNextPage={feed.fetchNextPage}
          empty={feed.items.length === 0 && !feed.loading}
        />
      )}
    </PageContainer>
  );
}
