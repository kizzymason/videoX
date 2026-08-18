import * as React from 'react';
import { Link } from 'react-router-dom';
import { Crown, Lock, Play } from 'lucide-react';
import { formatCount, formatDuration, formatRelativeTime, type VideoSummary } from '@videox/shared';
import { Badge, Skeleton, cn } from '@videox/ui';
import { contentApi } from '../../lib/api';

export interface VideoCardProps {
  video: VideoSummary;
  /** 历史记录卡片底部的观看进度条 */
  progressPercent?: number;
  className?: string;
  /** 紧凑模式用于播放页右侧的相关推荐列表 */
  layout?: 'grid' | 'row';
}

/**
 * 视频卡片。极简策略：无边框无阴影，靠 16:9 封面本身分区；信息只留标题、
 * 作者、播放量与时间四项，其余全部让位给留白。
 */
export function VideoCard({ video, progressPercent, className, layout = 'grid' }: VideoCardProps) {
  const [hovering, setHovering] = React.useState(false);
  const prefetched = React.useRef(false);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const onEnter = () => {
    // 悬停 400ms 才认为是真的想看，避免鼠标划过就发一堆预取请求。
    hoverTimer.current = setTimeout(() => {
      setHovering(true);
      if (!prefetched.current) {
        prefetched.current = true;
        void contentApi.video(video.id).catch(() => undefined);
      }
    }, 400);
  };

  const onLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovering(false);
    videoRef.current?.pause();
  };

  React.useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const isVip = video.accessLevel === 'vip';
  const isRow = layout === 'row';

  return (
    <Link
      to={`/watch/${video.slug || video.id}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
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
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Play className="size-6" />
          </div>
        )}

        {/* 悬停预览片段：只有存在预览文件时才挂 video 元素 */}
        {hovering && video.previewUrl ? (
          <video
            ref={videoRef}
            src={video.previewUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}

        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>

        {isVip ? (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-vip px-1.5 py-0.5 text-[11px] font-semibold text-vip-foreground">
            <Crown className="size-3" />
            会员
          </span>
        ) : video.accessLevel === 'login' ? (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Lock className="size-3" />
            登录可看
          </span>
        ) : null}

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
