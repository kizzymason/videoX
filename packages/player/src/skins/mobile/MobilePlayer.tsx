import * as React from 'react';
import {
  Captions,
  ChevronLeft,
  Gauge,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Sun,
  Unlock,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatDuration } from '@videox/shared';
import { cn } from '../../lib/cn.js';
import { PLAYBACK_RATES } from '../../core/engine.js';
import { usePlayer, type UsePlayerOptions } from '../../react/use-player.js';
import { ProgressBar } from '../shared/progress-bar.js';
import { ErrorVeil, GateVeil, LoadingVeil } from '../shared/overlays.js';
import { useCaptions } from '../shared/use-captions.js';
import { useGestures } from './use-gestures.js';

export interface MobilePlayerProps extends UsePlayerOptions {
  poster?: string | null;
  title?: string;
  className?: string;
  onBack?: () => void;
  onUnlock?: () => void;
  onLogin?: () => void;
  loggedIn?: boolean;
  /** 点击「清晰度/倍速」时交给外部的底部抽屉承载，不传则用内置浮层 */
  onOpenSettings?: () => void;
}

const CONTROL_HIDE_DELAY = 3200;

/**
 * 移动皮肤。跟 PC 皮肤完全分开写：这里没有 hover，控件必须更大更少，
 * 主要交互靠手势而不是按钮，并且要处理锁屏、横屏与安全区。
 */
export function MobilePlayer({
  poster,
  title,
  className,
  onBack,
  onUnlock,
  onLogin,
  loggedIn = true,
  onOpenSettings,
  ...playerOptions
}: MobilePlayerProps) {
  const { engine, snapshot, videoRef, containerRef, spriteCues } = usePlayer({ hotkeys: false, ...playerOptions });
  const captions = useCaptions(playerOptions.source?.captions, videoRef);
  const hasCaptions = (playerOptions.source?.captions?.length ?? 0) > 0;

  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [locked, setLocked] = React.useState(false);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [brightness, setBrightness] = React.useState(1);
  const [panel, setPanel] = React.useState<'none' | 'rate' | 'quality' | 'captions'>('none');
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = React.useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY);
  }, []);

  const toggleControls = React.useCallback(() => {
    setControlsVisible((visible) => {
      if (visible) return false;
      scheduleHide();
      return true;
    });
  }, [scheduleHide]);

  React.useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);

  const { hint, handlers } = useGestures({
    engine,
    onTap: toggleControls,
    brightness,
    setBrightness,
    disabled: locked || snapshot.gate.blocked || Boolean(snapshot.error),
  });

  const pinned = scrubbing || panel !== 'none';
  const showControls = (controlsVisible || pinned) && !locked;
  const buffering = snapshot.status === 'loading' || snapshot.status === 'buffering';

  const enterFullscreen = async () => {
    await engine.toggleFullscreen(containerRef.current);
    // 横屏锁定：进全屏后转到横向，退出时释放。仅 Android Chrome 支持。
    const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    try {
      if (document.fullscreenElement) await orientation?.lock?.('landscape');
      else orientation?.unlock?.();
    } catch {
      /* 桌面浏览器或 iOS 不支持，忽略 */
    }
  };

  const panelTitle = panel === 'rate' ? '播放速度' : panel === 'quality' ? '清晰度' : '字幕';

  return (
    <div
      ref={containerRef}
      className={cn('relative aspect-video w-full touch-none overflow-hidden bg-black select-none', className)}
      {...handlers}
    >
      <video
        ref={videoRef}
        className="size-full bg-black object-contain"
        poster={poster ?? undefined}
        crossOrigin="use-credentials"
      >
        {captions.tracksReady
          ? captions.tracks.map((track) => (
              <track
                key={track.lang}
                kind="subtitles"
                src={track.src}
                srcLang={track.lang}
                label={captions.labelFor(track.lang)}
              />
            ))
          : null}
      </video>
      {/* 白字薄黑影，不要 karaoke 底框。cue 只能画在 video 里。 */}
      <style>{`video::cue{color:#fff;background:transparent;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.4)}`}</style>

      {poster && !snapshot.hasFirstFrame ? (
        <img src={poster} alt="" className="pointer-events-none absolute inset-0 size-full object-contain" />
      ) : null}

      {/* 软件亮度：真机上没法调系统亮度，压一层黑蒙版是移动端播放器的通行做法 */}
      {brightness < 1 ? (
        <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 1 - brightness }} />
      ) : null}

      <LoadingVeil show={buffering && !snapshot.error} />
      <ErrorVeil error={snapshot.error} onRetry={() => engine.retry()} />
      <GateVeil
        show={snapshot.gate.blocked}
        previewSeconds={snapshot.gate.previewSeconds}
        onUnlock={() => onUnlock?.()}
        onLogin={onLogin}
        loggedIn={loggedIn}
      />

      <GestureHintLayer hint={hint} />

      {/* 锁屏后只留一个解锁按钮 */}
      {locked ? (
        <button
          type="button"
          aria-label="解锁"
          onClick={() => setLocked(false)}
          className="absolute top-1/2 left-3 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm"
        >
          <Lock className="size-5" />
        </button>
      ) : null}

      {/* 顶栏 */}
      <div
        className={cn(
          'pt-safe absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/75 to-transparent px-2 pb-8 transition-opacity',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {onBack ? (
          <button type="button" aria-label="返回" onClick={onBack} className="grid size-10 place-items-center text-white">
            <ChevronLeft className="size-6" />
          </button>
        ) : null}
        <span className="flex-1 truncate text-sm font-medium text-white">{title}</span>
        <button
          type="button"
          aria-label="锁定屏幕"
          onClick={() => setLocked(true)}
          className="grid size-10 place-items-center text-white"
        >
          <Unlock className="size-5" />
        </button>
      </div>

      {/* 中央播放按钮 */}
      {snapshot.paused && !buffering && !snapshot.error && !snapshot.gate.blocked ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-14 place-items-center rounded-full bg-black/45 backdrop-blur-sm">
            <Play className="size-6 translate-x-0.5 fill-white text-white" />
          </span>
        </div>
      ) : null}

      {/* 底栏 */}
      <div
        className={cn(
          'pb-safe absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-3 pt-10 transition-opacity',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <ProgressBar
          touch
          currentTime={snapshot.currentTime}
          duration={snapshot.duration}
          bufferedTo={snapshot.bufferedTo}
          previewLimit={snapshot.gate.previewSeconds}
          spriteCues={spriteCues}
          onSeek={(t) => engine.seek(t)}
          onScrubChange={setScrubbing}
        />

        <div className="flex items-center gap-1 pb-1.5 text-white">
          <button
            type="button"
            aria-label={snapshot.paused ? '播放' : '暂停'}
            onClick={() => engine.togglePlay()}
            className="grid size-9 place-items-center"
          >
            {snapshot.paused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
          </button>
          <button
            type="button"
            aria-label="静音"
            onClick={() => engine.toggleMute()}
            className="grid size-9 place-items-center"
          >
            {snapshot.muted || snapshot.volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>

          <span className="ml-1 text-xs tabular-nums text-white/85">
            {formatDuration(snapshot.currentTime)}
            <span className="mx-0.5 text-white/40">/</span>
            {formatDuration(snapshot.duration)}
          </span>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => (onOpenSettings ? onOpenSettings() : setPanel('rate'))}
            className="flex h-9 items-center gap-1 px-2 text-xs font-medium"
          >
            <Gauge className="size-4" />
            {snapshot.playbackRate}x
          </button>
          {snapshot.levels.length > 0 ? (
            <button
              type="button"
              onClick={() => (onOpenSettings ? onOpenSettings() : setPanel('quality'))}
              className="flex h-9 items-center gap-1 px-2 text-xs font-medium"
            >
              <Settings2 className="size-4" />
              {snapshot.autoQuality ? '自动' : (snapshot.levels.find((l) => l.index === snapshot.selectedLevel)?.label ?? '自动')}
            </button>
          ) : null}
          {hasCaptions ? (
            <button
              type="button"
              aria-label="字幕"
              onClick={() => setPanel('captions')}
              className="grid size-9 place-items-center"
            >
              <Captions className="size-5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="全屏"
            onClick={() => void enterFullscreen()}
            className="grid size-9 place-items-center"
          >
            {snapshot.isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        </div>
      </div>

      {/* 内置浮层：外部没接抽屉时的兜底 */}
      {panel !== 'none' ? (
        <div className="absolute inset-0 z-30 flex justify-end bg-black/50" onClick={() => setPanel('none')}>
          <div
            className="pb-safe flex w-48 flex-col gap-1 overflow-y-auto bg-black/90 p-3 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2 pb-1 text-xs text-white/50">{panelTitle}</p>
            {panel === 'rate'
              ? PLAYBACK_RATES.map((rate) => (
                  <PanelItem
                    key={rate}
                    active={snapshot.playbackRate === rate}
                    onClick={() => {
                      engine.setRate(rate);
                      setPanel('none');
                    }}
                  >
                    {rate === 1 ? '正常' : `${rate}x`}
                  </PanelItem>
                ))
              : panel === 'quality'
                ? [
                    <PanelItem
                      key="auto"
                      active={snapshot.autoQuality}
                      onClick={() => {
                        engine.setLevel(-1);
                        setPanel('none');
                      }}
                    >
                      自动
                    </PanelItem>,
                    ...[...snapshot.levels]
                      .sort((a, b) => b.height - a.height)
                      .map((level) => (
                        <PanelItem
                          key={level.index}
                          active={!snapshot.autoQuality && snapshot.selectedLevel === level.index}
                          onClick={() => {
                            engine.setLevel(level.index);
                            setPanel('none');
                          }}
                        >
                          {level.label}
                        </PanelItem>
                      )),
                  ]
                : [
                    <PanelItem
                      key="off"
                      active={captions.selected === 'off'}
                      onClick={() => {
                        captions.setSelected('off');
                        setPanel('none');
                      }}
                    >
                      关闭
                    </PanelItem>,
                    ...(playerOptions.source?.captions ?? []).map((track) => (
                      <PanelItem
                        key={track.lang}
                        active={captions.selected === track.lang}
                        onClick={() => {
                          captions.setSelected(track.lang);
                          setPanel('none');
                        }}
                      >
                        {captions.labelFor(track.lang)}
                      </PanelItem>
                    )),
                  ]}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-2 text-left text-sm transition-colors',
        active ? 'bg-white/15 font-medium text-white' : 'text-white/75',
      )}
    >
      {children}
    </button>
  );
}

function GestureHintLayer({ hint }: { hint: ReturnType<typeof useGestures>['hint'] }) {
  if (hint.kind === 'none') return null;

  if (hint.kind === 'seek') {
    return (
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-black/60 px-5 py-3 text-white backdrop-blur-sm',
          hint.direction === 'forward' ? 'right-[12%]' : 'left-[12%]',
        )}
      >
        {hint.direction === 'forward' ? <RotateCw className="size-6" /> : <RotateCcw className="size-6" />}
        <span className="text-xs tabular-nums">{hint.delta} 秒</span>
      </div>
    );
  }

  if (hint.kind === 'rate') {
    return (
      <div className="pointer-events-none absolute top-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/65 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        {hint.value}x 倍速播放中
      </div>
    );
  }

  if (hint.kind === 'scrub') {
    return (
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/65 px-4 py-2 text-white backdrop-blur-sm">
        <span className="text-lg font-medium tabular-nums">{formatDuration(hint.time)}</span>
        <span className="ml-2 text-xs text-white/60 tabular-nums">
          {hint.delta >= 0 ? '+' : ''}
          {Math.round(hint.delta)}s
        </span>
      </div>
    );
  }

  const value = hint.value;
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-white backdrop-blur-sm">
      {hint.kind === 'volume' ? (
        value === 0 ? (
          <VolumeX className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )
      ) : (
        <Sun className="size-4" />
      )}
      <div className="h-1 w-24 overflow-hidden rounded-full bg-white/25">
        <div className="h-full bg-white" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
