import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Search as SearchIcon } from 'lucide-react';
import type { SortOption } from '@videox/shared';
import { EmptyState, ListPager, Skeleton, cn, useBrowseMode } from '@videox/ui';
import { contentApi } from '../lib/api';
import { useBrowsableList } from '../lib/query';
import { useSeo } from '../hooks/use-seo';
import { useSite } from '../hooks/use-site';
import { PageContainer, PageHeader } from '../components/Page';
import { SortTabs } from '../components/SortTabs';
import { VideoGrid } from '../components/video/VideoGrid';
import { InfiniteFooter } from '../components/InfiniteFooter';

// ---------------------------------------------------------------------------
// 发现：纯推荐流
// ---------------------------------------------------------------------------

export function ExplorePage() {
  useSeo({ title: '发现', description: '算法为你挑选的内容' });
  const { data: site } = useSite();
  const { mode } = useBrowseMode(site?.defaultBrowseMode ?? 'paged');

  const paged = useBrowsableList(
    ['explore-paged'],
    (page, pageSize) => contentApi.videos({ page, pageSize, sort: 'recommended' }),
    { enabled: mode === 'paged' },
  );

  const infinite = useInfiniteQuery({
    queryKey: ['explore'],
    // 推荐接口不分页，靠 exclude 把已经推过的排掉，避免翻页翻出重复内容。
    queryFn: ({ pageParam }) => contentApi.recommend({ limit: 24, exclude: pageParam }),
    initialPageParam: '',
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length === 0) return undefined;
      return allPages
        .flat()
        .map((v) => v.id)
        .slice(-120)
        .join(',');
    },
    staleTime: 0,
    placeholderData: keepPreviousData,
    enabled: mode === 'infinite',
  });

  const videos = mode === 'paged' ? paged.items : (infinite.data?.pages.flat() ?? []);
  const loading = mode === 'paged' ? paged.loading : infinite.isLoading;
  const fetching =
    mode === 'paged'
      ? paged.fetching
      : infinite.isFetching && !infinite.isFetchingNextPage && videos.length > 0;
  const count = mode === 'paged' ? (paged.meta?.total ?? videos.length) : videos.length;

  return (
    <PageContainer>
      <PageHeader title="发现" description={loading ? '正在为你挑选…' : `已为你计算 ${count} 条个性化推荐`} />
      <VideoGrid
        videos={videos}
        loading={loading}
        loadingMore={mode === 'infinite' && infinite.isFetchingNextPage}
        fetching={fetching}
        transitionKey={mode === 'paged' ? paged.transitionKey : 'explore'}
      />
      {mode === 'paged' ? (
        <ListPager meta={paged.meta} page={paged.page} onChange={paged.setPage} busy={paged.fetching} />
      ) : (
        <InfiniteFooter
          hasNextPage={infinite.hasNextPage}
          isFetchingNextPage={infinite.isFetchingNextPage}
          fetchNextPage={() => void infinite.fetchNextPage()}
          empty={videos.length === 0 && !infinite.isLoading}
        />
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 分类总览
// ---------------------------------------------------------------------------

export function CategoriesPage() {
  useSeo({ title: '全部频道' });
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: contentApi.categories });
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: () => contentApi.tags(40) });

  return (
    <PageContainer>
      <PageHeader title="全部频道" description="按频道浏览全站内容" />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/9] rounded-xl" />
          ))}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState icon={<LayoutGrid />} title="还没有频道" />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data!.map((category) => (
            <Link
              key={category.id}
              to={`/category/${category.slug}`}
              className="group relative overflow-hidden rounded-xl border border-border transition-colors hover:border-foreground/25"
            >
              <div className="aspect-[16/9] w-full bg-muted">
                {category.coverUrl ? (
                  <img
                    src={category.coverUrl}
                    alt={category.name}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-500 ease-out-quint group-hover:scale-[1.03]"
                  />
                ) : null}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3">
                <p className="text-sm font-medium text-white">{category.name}</p>
                <p className="text-xs text-white/65 tabular-nums">{category.videoCount} 个视频</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tags && tags.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">热门标签</h2>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/search?q=${encodeURIComponent(tag.name)}`}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
              >
                #{tag.name}
                <span className="ml-1.5 text-xs text-muted-foreground/60 tabular-nums">{tag.videoCount}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 单个分类
// ---------------------------------------------------------------------------

export function CategoryPage() {
  const { slug = '' } = useParams();
  const [sort, setSort] = React.useState<SortOption>('latest');

  const { data: category } = useQuery({
    queryKey: ['category', slug],
    queryFn: () => contentApi.category(slug),
  });

  useSeo(category ? { title: category.name, description: category.description ?? undefined } : undefined);

  const query = useBrowsableList(['category-videos', slug, sort], (page, pageSize) =>
    contentApi.videos({ page, pageSize, categorySlug: slug, sort }),
  );

  return (
    <PageContainer>
      <PageHeader
        title={category?.name ?? '频道'}
        description={category?.description ?? undefined}
        action={
          <SortTabs
            value={sort}
            onChange={(value) => {
              setSort(value);
              query.setPage(1);
            }}
          />
        }
      />
      <VideoGrid
        videos={query.items}
        loading={query.loading}
        loadingMore={query.mode === 'infinite' && query.isFetchingNextPage}
        fetching={query.fetching}
        transitionKey={query.transitionKey}
      />
      {query.mode === 'paged' ? (
        <ListPager meta={query.meta} page={query.page} onChange={query.setPage} busy={query.fetching} />
      ) : (
        <InfiniteFooter
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          empty={query.items.length === 0 && !query.loading}
        />
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

const DURATION_FILTERS = [
  { label: '不限', min: undefined, max: undefined },
  { label: '4 分钟内', min: undefined, max: 240 },
  { label: '4-20 分钟', min: 240, max: 1200 },
  { label: '20 分钟以上', min: 1200, max: undefined },
] as const;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sort = (params.get('sort') as SortOption | null) ?? 'recommended';
  const durationIndex = Number(params.get('d') ?? 0);
  const categoryId = params.get('categoryId') ?? undefined;

  useSeo({ title: q ? `${q} 的搜索结果` : '搜索' });

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: contentApi.categories });
  const duration = DURATION_FILTERS[durationIndex] ?? DURATION_FILTERS[0]!;

  const query = useBrowsableList(
    ['search', q, sort, durationIndex, categoryId],
    (page, pageSize) =>
      contentApi.search({
        q,
        page,
        pageSize,
        sort,
        categoryId,
        minDuration: duration.min,
        maxDuration: duration.max,
      }),
    { enabled: q.length > 0 },
  );

  const total = query.meta?.total ?? 0;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    setParams(next, { replace: true });
  };

  if (!q) {
    return (
      <PageContainer>
        <EmptyState icon={<SearchIcon />} title="输入关键词开始搜索" description="支持标题、标签与创作者" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <>
            <span className="text-muted-foreground">搜索</span> {q}
          </>
        }
        description={query.loading ? '搜索中…' : `找到 ${total} 个结果`}
      />

      <div className="space-y-3 border-y border-border py-4">
        <FilterRow label="排序">
          <SortTabs value={sort} onChange={(value) => update({ sort: value })} />
        </FilterRow>
        <FilterRow label="时长">
          <div className="flex flex-wrap gap-1">
            {DURATION_FILTERS.map((filter, index) => (
              <FilterChip
                key={filter.label}
                active={index === durationIndex}
                onClick={() => update({ d: index === 0 ? undefined : String(index) })}
              >
                {filter.label}
              </FilterChip>
            ))}
          </div>
        </FilterRow>
        {categories && categories.length > 0 ? (
          <FilterRow label="频道">
            <div className="flex flex-wrap gap-1">
              <FilterChip active={!categoryId} onClick={() => update({ categoryId: undefined })}>
                全部
              </FilterChip>
              {categories.slice(0, 12).map((category) => (
                <FilterChip
                  key={category.id}
                  active={categoryId === category.id}
                  onClick={() => update({ categoryId: category.id })}
                >
                  {category.name}
                </FilterChip>
              ))}
            </div>
          </FilterRow>
        ) : null}
      </div>

      <VideoGrid
        videos={query.items}
        loading={query.loading}
        loadingMore={query.mode === 'infinite' && query.isFetchingNextPage}
        fetching={query.fetching}
        transitionKey={query.transitionKey}
        emptyTitle="没有找到相关视频"
        emptyDescription="换个关键词，或者放宽筛选条件试试"
      />
      {query.mode === 'paged' ? (
        <ListPager meta={query.meta} page={query.page} onChange={query.setPage} busy={query.fetching} />
      ) : (
        <InfiniteFooter
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          empty={query.items.length === 0 && !query.loading}
        />
      )}
    </PageContainer>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
