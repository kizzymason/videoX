import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Search, TrendingUp, X } from 'lucide-react';
import { Skeleton, useDebouncedValue, useLocalStorage } from '@videox/ui';
import { contentApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { track } from '../lib/analytics';
import { MasonryFeed } from '../components/MasonryFeed';

export function SearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';

  const [input, setInput] = React.useState(q);
  const debounced = useDebouncedValue(input.trim(), 220);
  const [history, setHistory] = useLocalStorage<string[]>('videox:search-history', []);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: contentApi.categories,
    staleTime: 10 * 60_000,
  });
  const { data: hot } = useQuery({ queryKey: ['hot'], queryFn: contentApi.hotKeywords, staleTime: 5 * 60_000 });
  const { data: suggestions, isFetching: suggesting } = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: () => contentApi.suggest(debounced),
    enabled: debounced.length > 0 && debounced !== q,
  });

  const results = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam }) => contentApi.search({ q, page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });

  const submit = (keyword: string) => {
    const value = keyword.trim();
    if (!value) return;
    track('search', { keyword: value });
    setHistory([value, ...history.filter((h) => h !== value)].slice(0, 12));
    setInput(value);
    setParams({ q: value }, { replace: true });
  };

  const videos = flatten(results.data?.pages);
  const showResults = q.length > 0 && debounced === q;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pt-safe sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex items-center gap-2 px-2 pt-3 pb-1">
          <button
            type="button"
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="no-tap-highlight grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-[20px] font-semibold tracking-tight">PandaGV</h1>
        </div>
        <div className="flex items-center gap-2 px-3 pt-2 pb-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={input}
              autoFocus={!q}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit(input)}
              placeholder="搜索视频、标签"
              enterKeyHint="search"
              className="h-9 w-full rounded-full border border-input bg-muted/60 pr-9 pl-9 text-sm outline-none focus:border-ring"
            />
            {input ? (
              <button
                type="button"
                aria-label="清空"
                onClick={() => setInput('')}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => submit(input)}
            className="no-tap-highlight shrink-0 px-2 text-sm font-medium"
          >
            搜索
          </button>
        </div>
      </div>

      {debounced.length > 0 && debounced !== q && suggesting && !suggestions ? (
        <div className="flex-1 space-y-2 px-4 pt-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : debounced.length > 0 && debounced !== q && suggestions ? (
        <div className="tab-scroll flex-1 divide-y divide-border">
          {suggestions.tags.map((tag) => (
            <button
              key={tag.slug}
              type="button"
              onClick={() => submit(tag.name)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-200 active:bg-accent"
            >
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{tag.videoCount}</span>
            </button>
          ))}
          {suggestions.videos.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/watch/${item.id}`)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 active:bg-accent"
            >
              {item.posterUrl ? (
                <img src={item.posterUrl} alt="" className="h-11 w-20 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="h-11 w-20 shrink-0 rounded-md bg-muted" />
              )}
              <span className="line-clamp-2 flex-1 text-[13px]">{item.title}</span>
            </button>
          ))}
        </div>
      ) : showResults ? (
        <div className="tab-scroll flex-1">
          <MasonryFeed
            videos={videos}
            loading={results.isLoading}
            loadingMore={results.isFetchingNextPage}
            fetching={results.isFetching && !results.isFetchingNextPage && videos.length > 0}
            hasMore={results.hasNextPage}
            onEndReached={() => void results.fetchNextPage()}
            className="pt-3"
          />
        </div>
      ) : (
        <div className="tab-scroll flex-1 space-y-6 px-4 pt-4">
          {categories && categories.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold">频道</h2>
              <div className="grid grid-cols-2 gap-2.5">
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    to={`/category/${category.slug}`}
                    className="no-tap-highlight rounded-xl bg-muted/70 px-3.5 py-3.5 active:bg-muted"
                  >
                    <p className="truncate text-[14px] font-medium">{category.name}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{category.videoCount} 部</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">搜索历史</h2>
                <button type="button" onClick={() => setHistory([])} className="text-xs text-muted-foreground">
                  清空
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => submit(keyword)}
                    className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground"
                  >
                    {keyword}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {hot && hot.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <TrendingUp className="size-4" />
                热门搜索
              </h2>
              <div className="space-y-0.5">
                {hot.map((keyword, index) => (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => submit(keyword)}
                    className="flex w-full items-center gap-3 rounded-lg py-2.5 text-left text-sm transition-colors duration-200 active:bg-accent"
                  >
                    <span
                      className={
                        index < 3
                          ? 'w-4 shrink-0 text-center text-sm font-semibold text-foreground'
                          : 'w-4 shrink-0 text-center text-sm text-muted-foreground'
                      }
                    >
                      {index + 1}
                    </span>
                    <span className="truncate">{keyword}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
