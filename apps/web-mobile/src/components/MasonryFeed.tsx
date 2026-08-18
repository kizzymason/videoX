import * as React from 'react';
import type { VideoSummary } from '@videox/shared';
import { Skeleton, cn } from '@videox/ui';
import { MobileVideoCard, cardHeight } from './MobileVideoCard';

const GAP = 10;
const COLUMNS = 2;
/** 视口外多渲染这么多像素，快速滑动时不会看到白块。 */
const OVERSCAN = 900;

interface Placed {
  video: VideoSummary;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface MasonryFeedProps {
  videos: VideoSummary[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onEndReached?: () => void;
  /** 列表顶部插入的内容（轮播、分类胶囊等） */
  header?: React.ReactNode;
  emptyText?: string;
  className?: string;
}

/**
 * 2 列虚拟化瀑布流。
 *
 * 没有直接用现成的虚拟列表库：masonry 的每一项高度取决于封面比例，
 * 需要先自己做一次列高分配，拿到绝对定位后再按滚动位置裁窗口。
 * 好处是滑几千条也只挂着二三十个 DOM 节点。
 */
export function MasonryFeed({
  videos,
  loading,
  loadingMore,
  hasMore,
  onEndReached,
  header,
  emptyText = '这里还没有内容',
  className,
}: MasonryFeedProps) {
  // 容器在骨架屏与真实列表之间会整体换挂，用 state 持有节点，
  // 这样重新挂载时测量与滚动订阅都会跟着重跑（用 ref 的话首帧测不到宽度，列表会一直是空的）。
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(800);

  React.useLayoutEffect(() => {
    if (!container) return undefined;
    setWidth(container.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  // 滚动容器是外层的 tab-scroll，不是这个组件自身。
  React.useEffect(() => {
    const scroller = container?.closest('.tab-scroll') as HTMLElement | null;
    if (!scroller) return undefined;

    const syncViewport = () => setViewportHeight(scroller.clientHeight);
    syncViewport();
    const observer = new ResizeObserver(syncViewport);
    observer.observe(scroller);

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(Math.max(0, scroller.scrollTop - (container?.offsetTop ?? 0)));
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [container]);

  const { placed, totalHeight } = React.useMemo(() => {
    if (width === 0) return { placed: [] as Placed[], totalHeight: 0 };
    const columnWidth = (width - GAP * (COLUMNS - 1)) / COLUMNS;
    const heights = new Array<number>(COLUMNS).fill(0);
    const result: Placed[] = [];

    for (const video of videos) {
      // 永远放进当前最矮的一列，两列高度差不会随着滚动越拉越大。
      let column = 0;
      for (let i = 1; i < COLUMNS; i += 1) {
        if (heights[i]! < heights[column]!) column = i;
      }
      const height = cardHeight(video, columnWidth);
      result.push({
        video,
        top: heights[column]!,
        left: column * (columnWidth + GAP),
        width: columnWidth,
        height,
      });
      heights[column] = heights[column]! + height + GAP;
    }

    // 末尾那一次 GAP 是虚的，留着会在底部多出一条空隙。
    return { placed: result, totalHeight: Math.max(0, Math.max(...heights) - GAP) };
  }, [videos, width]);

  const visible = React.useMemo(() => {
    const min = scrollTop - OVERSCAN;
    const max = scrollTop + viewportHeight + OVERSCAN;
    return placed.filter((item) => item.top + item.height >= min && item.top <= max);
  }, [placed, scrollTop, viewportHeight]);

  // 触底：距离底部不足一屏就预取下一页。
  React.useEffect(() => {
    if (!hasMore || loadingMore || totalHeight === 0) return;
    if (scrollTop + viewportHeight * 2 >= totalHeight) onEndReached?.();
  }, [scrollTop, viewportHeight, totalHeight, hasMore, loadingMore, onEndReached]);

  return (
    <div className={cn('px-3', className)}>
      {header}

      {/* 骨架屏也挂在同一个 ref 上，宽度在数据到达前就量好，首帧即可定位卡片 */}
      <div ref={setContainer} className="relative w-full" style={{ height: loading ? undefined : totalHeight }}>
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className={cn('w-full rounded-xl', i % 3 === 0 ? 'aspect-[3/4]' : 'aspect-video')} />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          visible.map((item) => (
            <div
              key={item.video.id}
              className="absolute"
              style={{ top: item.top, left: item.left, width: item.width, height: item.height }}
            >
              <MobileVideoCard video={item.video} />
            </div>
          ))
        )}
      </div>

      {!loading && videos.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {loadingMore ? '加载中…' : hasMore ? '' : videos.length > 0 ? '已经到底了' : ''}
        </div>
      )}
    </div>
  );
}
