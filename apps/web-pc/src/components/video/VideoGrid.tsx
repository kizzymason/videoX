import type { VideoSummary } from '@videox/shared';
import { EmptyState, cn } from '@videox/ui';
import { Clapperboard } from 'lucide-react';
import { VideoCard, VideoCardSkeleton } from './VideoCard';

export interface VideoGridProps {
  videos: VideoSummary[];
  loading?: boolean;
  /** 加载更多时追加的骨架数量 */
  loadingMore?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  progressOf?: (video: VideoSummary) => number | undefined;
  className?: string;
}

/**
 * 视频网格。列数按视口宽度自适应，最多 6 列——再多单卡就小到看不清封面了。
 */
export function VideoGrid({
  videos,
  loading,
  loadingMore,
  emptyTitle = '这里还没有内容',
  emptyDescription,
  progressOf,
  className,
}: VideoGridProps) {
  const gridClass = cn(
    'grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6',
    className,
  );

  if (loading) {
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
    <div className={gridClass}>
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} progressPercent={progressOf?.(video)} />
      ))}
      {loadingMore
        ? Array.from({ length: 6 }, (_, i) => <VideoCardSkeleton key={`more-${i}`} />)
        : null}
    </div>
  );
}
