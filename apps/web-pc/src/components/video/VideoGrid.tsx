import type { VideoSummary } from '@videox/shared';
import { EmptyState, ListLoadingBar, cn } from '@videox/ui';
import { Clapperboard } from 'lucide-react';
import { VideoCard, VideoCardSkeleton } from './VideoCard';

export interface VideoGridProps {
  videos: VideoSummary[];
  loading?: boolean;
  /** 加载更多时追加的骨架数量 */
  loadingMore?: boolean;
  /** 已有列表时的后台刷新（翻页 / 切筛选），顶部跑一条进度线，不卸卡片 */
  fetching?: boolean;
  /** 变化时重播进场动画，通常传 useBrowsableList 的 transitionKey */
  transitionKey?: string | number;
  emptyTitle?: string;
  emptyDescription?: string;
  progressOf?: (video: VideoSummary) => number | undefined;
  className?: string;
}

/**
 * 视频网格。列数按视口宽度自适应，最多 6 列——再多单卡就小到看不清封面了。
 * 全骨架只在真正没有数据时出现；有旧列表就留着，避免切「最新/热门」闪白。
 */
export function VideoGrid({
  videos,
  loading,
  loadingMore,
  fetching,
  transitionKey,
  emptyTitle = '这里还没有内容',
  emptyDescription,
  progressOf,
  className,
}: VideoGridProps) {
  const gridClass = cn(
    'grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6',
    className,
  );
  const showSkeleton = Boolean(loading) && videos.length === 0;

  if (showSkeleton) {
    return (
      <div className="space-y-2">
        <ListLoadingBar active />
        <div className={cn(gridClass, 'vx-list-enter')}>
          {Array.from({ length: 12 }, (_, i) => (
            <VideoCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return <EmptyState icon={<Clapperboard />} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-2">
      <ListLoadingBar active={fetching} />
      <div key={transitionKey} className={cn(gridClass, 'vx-list-enter')}>
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} progressPercent={progressOf?.(video)} />
        ))}
        {loadingMore
          ? Array.from({ length: 6 }, (_, i) => <VideoCardSkeleton key={`more-${i}`} />)
          : null}
      </div>
    </div>
  );
}
