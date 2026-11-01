import { Link } from 'react-router-dom';
import { formatCount, formatDuration, type VideoSummary } from '@videox/shared';
import { SmartImage, cn } from '@videox/ui';
import { prefetchWatchPage } from '../lib/prefetch-watch';
import { useShowViewCount } from '../hooks/use-site';

/**
 * 卡片文字区的高度预算（单列布局）。
 * 标题两行 2×20.3 ≈ 41、作者行 16、上下内边距 20、描边 2 —— 留到 82 有余量。
 * MasonryFeed 用它算虚拟列表的行高，算小了会出现"卡片压住下一张"。
 */
export const CARD_TEXT_HEIGHT = 82;

/** 列表封面统一 3:2 横图，不再按竖版封面走 3:4。 */
export const LIST_POSTER_ASPECT = '3 / 2';
export const LIST_POSTER_RATIO = 3 / 2;

export function posterRatio(_video: VideoSummary): number {
  return LIST_POSTER_RATIO;
}

export function cardHeight(_video: VideoSummary, columnWidth: number): number {
  return Math.round(columnWidth / LIST_POSTER_RATIO) + CARD_TEXT_HEIGHT;
}

/**
 * 移动端视频卡。
 *
 * 单列之后封面就是主角：整卡带描边和阴影，标题压在卡片内部，和封面是一体的一张卡，
 * 而不是"图 + 下面两行字"的松散组合。
 */
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
  const showViewCount = useShowViewCount();

  return (
    <Link
      to={`/watch/${video.slug || video.id}`}
      onPointerDown={prefetchWatchPage}
      className={cn('vx-card vx-press no-tap-highlight flex flex-col overflow-hidden rounded-2xl', className)}
    >
      <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: ratio }}>
        {poster ? <SmartImage src={poster} alt={video.title} loading="lazy" decoding="async" /> : null}

        {/* 只有拿到真实时长才显示。早期热链片源时长全是 0，标 00:00 反而误导。 */}
        {video.durationSeconds > 0 ? (
          <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
            {formatDuration(video.durationSeconds)}
          </span>
        ) : null}

        {progressPercent !== undefined && progressPercent > 0 ? (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <span className="block h-full bg-white" style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </span>
        ) : null}
      </div>

      <div className="px-3 pt-2 pb-3">
        <p className="line-clamp-2-cjk text-[14.5px] leading-[1.4] font-medium">{video.title}</p>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground">
          {video.author?.displayName ?? '未知作者'}
          {showViewCount ? (
            <>
              <span className="mx-1 text-muted-foreground/40">·</span>
              <span className="tabular-nums">{formatCount(video.viewCount)} 次播放</span>
            </>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
