import { Link } from 'react-router-dom';
import { formatCount, formatDuration, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';
import { prefetchWatchPage } from '../lib/prefetch-watch';

export const CARD_TEXT_HEIGHT = 62;

/** 列表封面统一 3:2 横图，不再按竖版封面走 3:4。 */
export const LIST_POSTER_ASPECT = '3 / 2';
export const LIST_POSTER_RATIO = 3 / 2;

export function posterRatio(_video: VideoSummary): number {
  return LIST_POSTER_RATIO;
}

export function cardHeight(_video: VideoSummary, columnWidth: number): number {
  return Math.round(columnWidth / LIST_POSTER_RATIO) + CARD_TEXT_HEIGHT;
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
  /** 列表封面默认 3:2 横图。 */
  aspect?: string;
}) {
  const poster = video.posterUrl ?? video.verticalPosterUrl;
  const ratio = aspect ?? LIST_POSTER_ASPECT;

  return (
    <Link
      to={`/watch/${video.slug || video.id}`}
      onPointerDown={prefetchWatchPage}
      className={cn('vx-press no-tap-highlight flex flex-col', className)}
    >
      <div className="relative w-full overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: ratio }}>
        {poster ? (
          <img src={poster} alt={video.title} loading="lazy" decoding="async" className="size-full object-cover" />
        ) : null}

        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
          {formatDuration(video.durationSeconds)}
        </span>
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
