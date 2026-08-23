import * as React from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * TikTok 式点按反馈：暂停后中央留下播放键；刚切换时闪一下对应图标。
 */
export function PlayPauseHint({
  paused,
  flash,
  className,
}: {
  paused: boolean;
  flash: 'play' | 'pause' | null;
  className?: string;
}) {
  const showPlay = flash === 'play' || (paused && flash !== 'pause');
  const showPause = flash === 'pause';
  if (!showPlay && !showPause) return null;

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10 grid place-items-center', className)}>
      <span
        key={flash ?? (paused ? 'paused' : 'idle')}
        className={cn(
          'grid size-16 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm',
          flash ? 'animate-in fade-in zoom-in-75 duration-200' : '',
        )}
      >
        {showPause ? (
          <Pause className="size-8 fill-white" />
        ) : (
          <Play className="size-8 translate-x-0.5 fill-white" />
        )}
      </span>
    </div>
  );
}

/** 点按后闪一下图标，再交给 PlayPauseHint 决定是否留下播放键。 */
export function usePlayPauseFlash(durationMs = 480) {
  const [flash, setFlash] = React.useState<'play' | 'pause' | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = React.useCallback(
    (next: 'play' | 'pause') => {
      setFlash(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), durationMs);
    },
    [durationMs],
  );

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { flash, trigger } as const;
}
