import { Link } from 'react-router-dom';
import { formatCount, formatDuration, formatRelativeTime, type VideoSummary } from '@videox/shared';
import { Badge, Skeleton, cn } from '@videox/ui';
import { prefetchWatchPage } from '../../lib/prefetch-watch';

export interface VideoCardProps {
  video: VideoSummary;
  /** 历史记录卡片底部的观看进度条 */
  progressPercent?: number;
  className?: string;
  /** 紧凑模式用于播放页右侧的相关推荐列表 */
  layout?: 'grid' | 'row';
}

/**
 * 视频卡片。点播有会员门禁，封面不挂悬停预览片。
 */
export function VideoCard({ video, progressPercent, className, layout = 'grid' }: VideoCardProps) {
  const isRow = layout === 'row';

  return (
    <Link
      to={`/watch/${video.slug || video.id}`}
      onMouseEnter={prefetchWatchPage}
      className={cn('group/card block', isRow ? 'flex gap-3' : 'space-y-2.5', className)}
    >
      <div
        className={cn(
          'hover-zoom relative overflow-hidden rounded-xl bg-muted',
          isRow ? 'aspect-video w-40 shrink-0' : 'aspect-video w-full',
        )}
      >
        {video.posterUrl ? (
          <img
            src={video.posterUrl}
            alt={video.title}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : null}

        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>

        {progressPercent !== undefined && progressPercent > 0 ? (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <span className="block h-full bg-primary" style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </span>
        ) : null}
      </div>

      <div className={cn('min-w-0', isRow && 'flex-1')}>
        <h3
          className={cn(
            'line-clamp-2-cjk text-sm leading-snug font-medium transition-colors group-hover/card:text-foreground/80',
            isRow && 'text-[13px]',
          )}
          title={video.title}
        >
          {video.title}
        </h3>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {video.author ? <span className="truncate">{video.author.displayName}</span> : null}
          {video.author ? <span className="text-muted-foreground/40">·</span> : null}
          <span className="shrink-0 tabular-nums">{formatCount(video.viewCount)} 播放</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="shrink-0">{formatRelativeTime(video.publishedAt ?? video.createdAt)}</span>
        </div>
        {video.recommendReason ? (
          <Badge variant="muted" className="mt-1.5">
            {video.recommendReason}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}

export function VideoCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'row' }) {
  if (layout === 'row') {
    return (
      <div className="flex gap-3">
        <Skeleton className="aspect-video w-40 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2 py-1">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}
