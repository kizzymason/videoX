import type { VideoSummary } from '@videox/shared';
import { EmptyState, Spinner, cn } from '@videox/ui';
import { Clapperboard } from 'lucide-react';
import { VideoCard, VideoCardSkeleton } from './VideoCard';

export interface VideoGridProps {
  videos: VideoSummary[];
  loading?: boolean;
  /** 加载更多时追加的骨架数量 */
  loadingMore?: boolean;
  /** 已有列表时的后台刷新（切 sort / 筛选），角上细转圈，不卸卡片 */
  fetching?: boolean;
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
      <div className={gridClass}>
        {Array.from({ length: 12 }, (_, i) => (
          <VideoCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return <EmptyState icon={<Clapperboard />} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="relative">
      <div className={cn(gridClass, 'vx-page-enter')}>
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} progressPercent={progressOf?.(video)} />
        ))}
        {loadingMore
          ? Array.from({ length: 6 }, (_, i) => <VideoCardSkeleton key={`more-${i}`} />)
          : null}
      </div>
      {fetching ? (
        <div className="pointer-events-none absolute top-0 right-0">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}
