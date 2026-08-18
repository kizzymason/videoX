import { QueryClient } from '@tanstack/react-query';
import type { Paginated } from '@videox/shared';
import { ApiError } from './api';

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
