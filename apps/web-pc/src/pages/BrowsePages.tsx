import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Search as SearchIcon } from 'lucide-react';
import type { SortOption } from '@videox/shared';
import { EmptyState, Skeleton, cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useSeo } from '../hooks/use-seo';
import { PageContainer, PageHeader } from '../components/Page';
import { SortTabs } from '../components/SortTabs';
import { VideoGrid } from '../components/video/VideoGrid';
import { InfiniteFooter } from '../components/InfiniteFooter';

// ---------------------------------------------------------------------------
// 发现：纯推荐流
// ---------------------------------------------------------------------------

export function ExplorePage() {
  useSeo({ title: '发现', description: '算法为你挑选的内容' });

  const query = useInfiniteQuery({
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
  });

  const videos = query.data?.pages.flat() ?? [];

  return (
    <PageContainer>
      <PageHeader title="发现" description={`已为你计算 ${videos.length} 条个性化推荐`} />
      <VideoGrid videos={videos} loading={query.isLoading} loadingMore={query.isFetchingNextPage} />
      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={videos.length === 0 && !query.isLoading}
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 分类总览
// ---------------------------------------------------------------------------

export function CategoriesPage() {
  useSeo({ title: '全部分类' });
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: contentApi.categories });
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: () => contentApi.tags(40) });

  return (
    <PageContainer>
      <PageHeader title="全部分类" description="按频道浏览全站内容" />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/9] rounded-xl" />
          ))}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState icon={<LayoutGrid />} title="还没有分类" />
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

  const query = useInfiniteQuery({
    queryKey: ['category-videos', slug, sort],
    queryFn: ({ pageParam }) => contentApi.videos({ page: pageParam, pageSize: 24, categorySlug: slug, sort }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const videos = flatten(query.data?.pages);

  return (
    <PageContainer>
      <PageHeader
        title={category?.name ?? '分类'}
        description={category?.description ?? undefined}
        action={<SortTabs value={sort} onChange={setSort} />}
      />
      <VideoGrid videos={videos} loading={query.isLoading} loadingMore={query.isFetchingNextPage} />
      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={videos.length === 0 && !query.isLoading}
      />
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

  const query = useInfiniteQuery({
    queryKey: ['search', q, sort, durationIndex, categoryId],
    queryFn: ({ pageParam }) =>
      contentApi.search({
        q,
        page: pageParam,
        pageSize: 24,
        sort,
        categoryId,
        minDuration: duration.min,
        maxDuration: duration.max,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: q.length > 0,
  });

  const videos = flatten(query.data?.pages);
  const total = query.data?.pages[0]?.meta.total ?? 0;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
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
        description={query.isLoading ? '搜索中…' : `找到 ${total} 个结果`}
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
          <FilterRow label="分类">
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
        videos={videos}
        loading={query.isLoading}
        loadingMore={query.isFetchingNextPage}
        emptyTitle="没有找到相关视频"
        emptyDescription="换个关键词，或者放宽筛选条件试试"
      />
      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={videos.length === 0 && !query.isLoading}
      />
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
