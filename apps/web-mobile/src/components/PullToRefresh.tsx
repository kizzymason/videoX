import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@videox/ui';

const TRIGGER_DISTANCE = 72;
const MAX_PULL = 110;

export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * 下拉刷新。只在滚动容器已经到顶时接管手势，否则完全放行给原生滚动——
 * 这一点做不好，列表中段下滑就会莫名其妙卡住。
 */
export function PullToRefresh({ onRefresh, children, className, disabled }: PullToRefreshProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef<number | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    if (disabled || refreshing) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = event.touches[0]!.clientY;
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (startY.current === null) return;
    const delta = event.touches[0]!.clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      startY.current = null;
      return;
    }
    // 阻尼曲线：越往下拉越沉，避免一甩就到底。
    setPull(Math.min(MAX_PULL, delta * 0.45));
  };

  const onTouchEnd = async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (pull < TRIGGER_DISTANCE) {
      setPull(0);
      return;
    }
    setRefreshing(true);
    setPull(TRIGGER_DISTANCE * 0.7);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  };

  const ready = pull >= TRIGGER_DISTANCE;

  return (
    <div
      ref={scrollRef}
      className={cn('tab-scroll relative flex-1', className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => void onTouchEnd()}
      onTouchCancel={() => {
        startY.current = null;
        setPull(0);
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden transition-[height]"
        style={{ height: pull }}
      >
        <RefreshCw
          className={cn(
            'size-5 text-muted-foreground transition-transform',
            refreshing && 'animate-spin',
            ready && !refreshing && 'text-foreground',
          )}
          style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }}
        />
      </div>
      <div
        style={{ transform: `translateY(${pull}px)` }}
        className={cn(!startY.current && 'transition-transform duration-300 ease-out-quint')}
      >
        {children}
      </div>
    </div>
  );
}
