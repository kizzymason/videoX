import * as React from 'react';
import { formatDuration } from '@videox/shared';
import { cn } from '../../lib/cn.js';
import { findSpriteCue } from '../../core/sprites.js';
import type { SpriteCue } from '../../types.js';

export interface ProgressBarProps {
  currentTime: number;
  duration: number;
  bufferedTo: number;
  /** 试看边界，超出部分画成不可达的灰色 */
  previewLimit?: number | null;
  spriteCues?: SpriteCue[];
  onSeek: (seconds: number) => void;
  /** 拖拽中实时回调，用于暂停自动隐藏控件 */
  onScrubChange?: (scrubbing: boolean) => void;
  className?: string;
  /** 移动端把命中区域加厚 */
  touch?: boolean;
}

/**
 * 进度条。拖拽时不直接 seek，而是先在本地跟手，松手才真正跳转——
 * 每移动一像素就 seek 一次会让 hls.js 疯狂丢弃缓冲区。
 */
export function ProgressBar({
  currentTime,
  duration,
  bufferedTo,
  previewLimit,
  spriteCues = [],
  onSeek,
  onScrubChange,
  className,
  touch = false,
}: ProgressBarProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [scrubTime, setScrubTime] = React.useState<number | null>(null);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);

  const total = duration || 0;
  const displayTime = scrubTime ?? currentTime;
  const pct = total > 0 ? (displayTime / total) * 100 : 0;
  const bufferedPct = total > 0 ? Math.min(100, (bufferedTo / total) * 100) : 0;
  const previewPct = previewLimit && total > 0 ? Math.min(100, (previewLimit / total) * 100) : null;

  const timeFromClientX = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || total === 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * total;
    },
    [total],
  );

  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (total === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubChange?.(true);
    setScrubTime(timeFromClientX(event.clientX));
  };

  const moveScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const time = timeFromClientX(event.clientX);
    setHoverTime(time);
    if (scrubTime !== null) setScrubTime(time);
  };

  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubTime === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onSeek(scrubTime);
    setScrubTime(null);
    onScrubChange?.(false);
  };

  const previewAt = hoverTime ?? scrubTime;
  const cue = previewAt !== null ? findSpriteCue(spriteCues, previewAt) : null;
  const previewLeft = total > 0 && previewAt !== null ? Math.max(0, Math.min(100, (previewAt / total) * 100)) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(displayTime)}
      tabIndex={0}
      className={cn('group/progress relative cursor-pointer select-none', touch ? 'py-3' : 'py-2', className)}
      onPointerDown={startScrub}
      onPointerMove={moveScrub}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={() => setHoverTime(null)}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-white/25 transition-[height]',
          touch ? 'h-1' : 'h-[3px] group-hover/progress:h-[5px]',
          scrubTime !== null && 'h-[5px]',
        )}
      >
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferedPct}%` }} />
        {previewPct !== null ? (
          <div
            className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.25)_4px,rgba(255,255,255,0.25)_8px)]"
            style={{ left: `${previewPct}%`, right: 0 }}
          />
        ) : null}
        <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
      </div>

      <div
        className={cn(
          'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-transform',
          touch ? 'scale-100' : 'scale-0 group-hover/progress:scale-100',
          scrubTime !== null && 'scale-110',
        )}
        style={{ left: `${pct}%` }}
      />

      {previewAt !== null && !touch ? (
        <div
          className="pointer-events-none absolute bottom-full mb-3 -translate-x-1/2 rounded-lg bg-black/85 p-1 text-center backdrop-blur-sm"
          style={{ left: `${previewLeft}%` }}
        >
          {cue ? (
            <div
              className="rounded-md bg-cover"
              style={{
                width: cue.w,
                height: cue.h,
                backgroundImage: `url(${cue.url})`,
                backgroundPosition: `-${cue.x}px -${cue.y}px`,
                backgroundSize: 'auto',
              }}
            />
          ) : null}
          <div className="px-1 pt-1 text-[11px] font-medium text-white tabular-nums">
            {formatDuration(previewAt)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
