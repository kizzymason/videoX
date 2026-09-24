import * as React from 'react';
import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BROWSE_PAGE_SIZE, type Paginated } from '@videox/shared';
import { useBrowseMode } from '@videox/ui';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from './api';
import { useSite } from '../hooks/use-site';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 401/403/404 重试没有意义，只会拖慢错误反馈。
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

/** 把后端的 { items, meta } 分页翻译成 useInfiniteQuery 需要的页码游标。 */
export function nextPageParam<T>(lastPage: Paginated<T>): number | undefined {
  return lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined;
}

export function flatten<T>(pages: Paginated<T>[] | undefined): T[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

function readPage(raw: string | null): number {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** 分页 / 无限流共用。paged 走单页 query，infinite 走原无限流。 */
export function useBrowsableList<T>(
  queryKey: unknown[],
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
  options: { enabled?: boolean; pageSize?: number; urlPage?: boolean } = {},
) {
  const { data: site } = useSite();
  const { mode } = useBrowseMode(site?.defaultBrowseMode ?? 'paged');
  const pageSize = options.pageSize ?? BROWSE_PAGE_SIZE;
  const enabled = options.enabled ?? true;
  const useUrl = options.urlPage !== false;

  const [params, setParams] = useSearchParams();
  const [localPage, setLocalPage] = React.useState(1);
  const page = useUrl ? readPage(params.get('page')) : localPage;

  const setPage = React.useCallback(
    (next: number) => {
      const safe = Math.max(1, Math.floor(next));
      if (useUrl) {
        const nextParams = new URLSearchParams(params);
        if (safe <= 1) nextParams.delete('page');
        else nextParams.set('page', String(safe));
        setParams(nextParams, { replace: true });
      } else {
        setLocalPage(safe);
      }
    },
    [params, setParams, useUrl],
  );

  // 翻页要平滑（留住上一页，配合 ListPager 的进度条），但换页签 / 换排序必须立刻让位给
  // 骨架屏——否则点了页签还停在旧列表上，看着像卡住了。所以只在「同一个列表」内沿用旧数据。
  const listKey = JSON.stringify(queryKey);
  const keepSameList = <D,>(
    previous: D | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
    tail: number,
  ): D | undefined => {
    if (!previous || !previousQuery) return undefined;
    return JSON.stringify(previousQuery.queryKey.slice(0, -tail)) === listKey ? previous : undefined;
  };

  const paged = useQuery({
    queryKey: [...queryKey, 'paged', page, pageSize],
    queryFn: () => fetchPage(page, pageSize),
    enabled: enabled && mode === 'paged',
    placeholderData: (previous, previousQuery) => keepSameList(previous, previousQuery, 3),
  });

  const infinite = useInfiniteQuery({
    queryKey: [...queryKey, 'infinite', pageSize],
    queryFn: ({ pageParam }) => fetchPage(pageParam, pageSize),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: enabled && mode === 'infinite',
    placeholderData: (previous, previousQuery) => keepSameList(previous, previousQuery, 2),
  });

  const items = mode === 'paged' ? (paged.data?.items ?? []) : flatten(infinite.data?.pages);
  const meta = mode === 'paged' ? paged.data?.meta : infinite.data?.pages[0]?.meta;
  const loading = mode === 'paged' ? paged.isLoading : infinite.isLoading;
  const fetching =
    mode === 'paged'
      ? paged.isFetching && items.length > 0
      : infinite.isFetching && !infinite.isFetchingNextPage && items.length > 0;

  return {
    mode,
    items,
    meta,
    page,
    setPage,
    /** 挂在列表容器的 key 上：换页 / 换列表时重播进场动画，无限流追加时保持不变。 */
    transitionKey: mode === 'paged' ? `${listKey}:${page}` : listKey,
    loading,
    fetching,
    isFetchingNextPage: infinite.isFetchingNextPage,
    hasNextPage: Boolean(infinite.hasNextPage),
    fetchNextPage: () => void infinite.fetchNextPage(),
    refetch: () => (mode === 'paged' ? paged.refetch() : infinite.refetch()),
  };
}
