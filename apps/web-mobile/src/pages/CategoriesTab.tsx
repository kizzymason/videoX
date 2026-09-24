import * as React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ListPager, cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { useBrowsableList } from '../lib/query';
import { AppHeader } from '../components/AppHeader';
import { PullToRefresh } from '../components/PullToRefresh';
import { MasonryFeed } from '../components/MasonryFeed';

/**
 * 分类 Tab：左侧竖排频道，右侧瀑布流。
 * 侧栏比顶部横滑更适合频道多的场景——一屏能看到十几个，不用来回滑。
 */
export function CategoriesTab() {
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: contentApi.categories });
  const [activeSlug, setActiveSlug] = React.useState<string | null>(null);

  const slug = activeSlug ?? categories?.[0]?.slug ?? null;

  const query = useBrowsableList(
    ['category-feed', slug],
    (page, pageSize) => contentApi.videos({ page, pageSize, categorySlug: slug!, sort: 'latest' }),
    { enabled: Boolean(slug), urlPage: false },
  );

  const videos = query.items;
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // 换频道时右侧列表滚回顶部；左栏与右栏都是 .tab-scroll，右栏在后面。
  const selectCategory = (nextSlug: string) => {
    if (nextSlug === slug) return;
    setActiveSlug(nextSlug);
    query.setPage(1);
    const scrollers = bodyRef.current?.querySelectorAll<HTMLElement>('.tab-scroll');
    scrollers?.[scrollers.length - 1]?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <AppHeader title="频道" showSearch />
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div className="tab-scroll w-[88px] shrink-0 border-r border-border bg-muted/30">
          {(categories ?? []).map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => selectCategory(category.slug)}
              className={cn(
                'no-tap-highlight relative block w-full px-2 py-3.5 text-center text-[13px] transition-colors duration-200',
                category.slug === slug ? 'bg-background font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {category.slug === slug ? (
                <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
              ) : null}
              <span className="line-clamp-1">{category.name}</span>
            </button>
          ))}
        </div>

        <PullToRefresh onRefresh={() => query.refetch()} className="min-w-0 flex-1">
          <MasonryFeed
            videos={videos}
            loading={query.loading}
            loadingMore={query.mode === 'infinite' && query.isFetchingNextPage}
            fetching={query.fetching}
            transitionKey={query.transitionKey}
            hasMore={query.mode === 'infinite' && query.hasNextPage}
            onEndReached={query.mode === 'infinite' ? query.fetchNextPage : undefined}
            showEndStatus={query.mode === 'infinite'}
            footer={
              query.mode === 'paged' ? (
                <ListPager meta={query.meta} page={query.page} onChange={query.setPage} busy={query.fetching} />
              ) : null
            }
            className="pt-3"
          />
        </PullToRefresh>
      </div>
    </>
  );
}

/** 从首页胶囊或搜索结果点进来的单分类页，带返回箭头。 */
export function CategoryPage() {
  const { slug = '' } = useParams();
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: contentApi.categories });
  const category = categories?.find((c) => c.slug === slug);

  const query = useBrowsableList(['category-feed', slug], (page, pageSize) =>
    contentApi.videos({ page, pageSize, categorySlug: slug, sort: 'latest' }),
  );

  const videos = query.items;

  return (
    <>
      <AppHeader back title={category?.name ?? '频道'} showSearch />
      <PullToRefresh onRefresh={() => query.refetch()}>
        <MasonryFeed
          videos={videos}
          loading={query.loading}
          loadingMore={query.mode === 'infinite' && query.isFetchingNextPage}
          fetching={query.fetching}
          transitionKey={query.transitionKey}
          hasMore={query.mode === 'infinite' && query.hasNextPage}
          onEndReached={query.mode === 'infinite' ? query.fetchNextPage : undefined}
          showEndStatus={query.mode === 'infinite'}
          footer={
            query.mode === 'paged' ? (
              <ListPager meta={query.meta} page={query.page} onChange={query.setPage} busy={query.fetching} />
            ) : null
          }
          className="pt-3"
        />
      </PullToRefresh>
    </>
  );
}

/** 频道页（创作者主页） */
export function ChannelPage() {
  const { username = '' } = useParams();
  const { data: channel } = useQuery({
    queryKey: ['channel', username],
    queryFn: () => contentApi.channel(username),
  });

  const query = useBrowsableList(['channel-videos', username], (page, pageSize) =>
    contentApi.channelVideos(username, page, pageSize),
  );

  const videos = query.items;

  return (
    <>
      <AppHeader back title={channel?.displayName ?? '频道'} />
      <PullToRefresh onRefresh={() => query.refetch()}>
        {channel ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <img
              src={channel.avatarUrl ?? ''}
              alt=""
              className="size-14 rounded-full bg-muted object-cover"
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{channel.displayName}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {channel.followerCount} 粉丝 · {channel.videoCount} 视频
              </p>
            </div>
          </div>
        ) : null}
        <MasonryFeed
          videos={videos}
          loading={query.loading}
          loadingMore={query.mode === 'infinite' && query.isFetchingNextPage}
          fetching={query.fetching}
          transitionKey={query.transitionKey}
          hasMore={query.mode === 'infinite' && query.hasNextPage}
          onEndReached={query.mode === 'infinite' ? query.fetchNextPage : undefined}
          showEndStatus={query.mode === 'infinite'}
          footer={
            query.mode === 'paged' ? (
              <ListPager meta={query.meta} page={query.page} onChange={query.setPage} busy={query.fetching} />
            ) : null
          }
        />
      </PullToRefresh>
    </>
  );
}
