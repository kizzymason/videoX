import { Spinner, useInfiniteSentinel } from '@videox/ui';

export interface InfiniteFooterProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** 列表为空时不显示「到底了」 */
  empty?: boolean;
}

/** 触底加载哨兵 + 状态文案。三个列表页共用同一套行为。 */
export function InfiniteFooter({ hasNextPage, isFetchingNextPage, fetchNextPage, empty }: InfiniteFooterProps) {
  const sentinelRef = useInfiniteSentinel(fetchNextPage, { enabled: hasNextPage && !isFetchingNextPage });

  if (empty) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-10 text-sm text-muted-foreground">
      {isFetchingNextPage ? (
        <span className="flex items-center gap-2">
          <Spinner />
          加载中
        </span>
      ) : hasNextPage ? (
        <span className="h-4" />
      ) : (
        <span className="text-muted-foreground/60">已经到底了</span>
      )}
    </div>
  );
}
