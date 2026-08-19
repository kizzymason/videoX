import { Link } from 'react-router-dom';
import { Crown, Play } from 'lucide-react';
import { formatCount, formatDuration, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';

export const CARD_TEXT_HEIGHT = 62;

/** 单张封面的宽高比。竖版封面走 3:4，其余按 16:9。 */
export function posterRatio(video: VideoSummary): number {
  return video.verticalPosterUrl ? 3 / 4 : 16 / 9;
}

export function cardHeight(video: VideoSummary, columnWidth: number): number {
  return Math.round(columnWidth / posterRatio(video)) + CARD_TEXT_HEIGHT;
}

export function MobileVideoCard({
  video,
  className,
  progressPercent,
  aspect,
}: {
  video: VideoSummary;
  className?: string;
  progressPercent?: number;
  /** 首页正方形瀑布流传 `1 / 1`。不传则按封面类型。 */
  aspect?: string;
}) {
  const poster = video.verticalPosterUrl ?? video.posterUrl;
  const ratio = aspect ?? (video.verticalPosterUrl ? '3 / 4' : '16 / 9');

  return (
    <Link to={`/watch/${video.slug || video.id}`} className={cn('no-tap-highlight flex flex-col', className)}>
      <div
        className="relative w-full overflow-hidden rounded-xl bg-muted"
        style={{ aspectRatio: ratio }}
      >
        {poster ? (
          <img src={poster} alt={video.title} loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Play className="size-5" />
          </div>
        )}

        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
        {video.accessLevel === 'vip' ? (
          <span className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded bg-vip text-vip-foreground">
            <Crown className="size-3" />
          </span>
        ) : null}
        {progressPercent !== undefined && progressPercent > 0 ? (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <span className="block h-full bg-white" style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </span>
        ) : null}
      </div>

      <div className="px-0.5 pt-1.5">
        <p className="line-clamp-2-cjk text-[13px] leading-[1.35] font-medium">{video.title}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {video.author?.displayName ?? '未知作者'}
          <span className="mx-1 text-muted-foreground/40">·</span>
          <span className="tabular-nums">{formatCount(video.viewCount)}</span>
        </p>
      </div>
    </Link>
  );
}
