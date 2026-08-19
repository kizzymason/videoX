import * as React from 'react';
import {
  Captions,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings,
  SkipForward,
  Volume1,
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

export interface DesktopPlayerProps extends UsePlayerOptions {
  poster?: string | null;
  title?: string;
  className?: string;
  /** 连播：有下一集时展示按钮 */
  onNext?: () => void;
  onUnlock?: () => void;
  onLogin?: () => void;
  loggedIn?: boolean;
}

const CONTROL_HIDE_DELAY = 2600;

/**
 * PC 皮肤。视觉上克制到底：纯黑底、白色控件、只在悬停时浮出一层渐变，
 * 不做任何彩色装饰——播放器不该跟内容抢注意力。
 */
export function DesktopPlayer({
  poster,
  title,
  className,
  onNext,
  onUnlock,
  onLogin,
  loggedIn = true,
  ...playerOptions
}: DesktopPlayerProps) {
  const { engine, snapshot, videoRef, containerRef, spriteCues } = usePlayer(playerOptions);
  const captions = useCaptions(playerOptions.source?.captions, videoRef);
  const hasCaptions = (playerOptions.source?.captions?.length ?? 0) > 0;

  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [scrubbing, setScrubbing] = React.useState(false);
  const [menu, setMenu] = React.useState<'none' | 'rate' | 'quality' | 'captions'>('none');
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const keepVisible = React.useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY);
  }, []);

  // 暂停、拖拽、菜单展开这三种状态下控件必须常驻，否则操作会被自己藏掉。
  const pinned = snapshot.paused || scrubbing || menu !== 'none' || Boolean(snapshot.error) || snapshot.gate.blocked;
  const showControls = controlsVisible || pinned;

  React.useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  React.useEffect(() => {
    if (pinned && hideTimer.current) clearTimeout(hideTimer.current);
  }, [pinned]);

  const currentQualityLabel = React.useMemo(() => {
    if (snapshot.autoQuality) {
      const active = snapshot.levels.find((l) => l.index === snapshot.currentLevel);
      return active ? `自动 ${active.label}` : '自动';
    }
    return snapshot.levels.find((l) => l.index === snapshot.selectedLevel)?.label ?? '自动';
  }, [snapshot.autoQuality, snapshot.currentLevel, snapshot.levels, snapshot.selectedLevel]);

  const VolumeIcon = snapshot.muted || snapshot.volume === 0 ? VolumeX : snapshot.volume < 0.5 ? Volume1 : Volume2;
  const buffering = snapshot.status === 'loading' || snapshot.status === 'buffering';

  return (
    <div
      ref={containerRef}
      className={cn(
        'group/player relative aspect-video w-full overflow-hidden bg-black select-none',
        !showControls && 'cursor-none',
        className,
      )}
      onMouseMove={keepVisible}
      onMouseLeave={() => !pinned && setControlsVisible(false)}
      onDoubleClick={() => void engine.toggleFullscreen(containerRef.current)}
    >
      <video
        ref={videoRef}
        className="size-full bg-black object-contain"
        poster={poster ?? undefined}
        onClick={() => engine.togglePlay()}
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
      {/* 白字薄黑影，不要 karaoke 底框。cue 只能画在 video 里，叠在进度条上方靠原生定位。 */}
      <style>{`video::cue{color:#fff;background:transparent;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.4)}`}</style>

      {/* 封面在首帧出来之前顶上，避免黑屏空窗 */}
      {poster && !snapshot.hasFirstFrame ? (
        <img src={poster} alt="" className="pointer-events-none absolute inset-0 size-full object-contain" />
      ) : null}

      <LoadingVeil show={buffering && !snapshot.error} />

      {/* 暂停时的中央播放按钮 */}
      {snapshot.paused && !buffering && !snapshot.error && !snapshot.gate.blocked ? (
        <button
          type="button"
          aria-label="播放"
          onClick={() => engine.togglePlay()}
          className="absolute inset-0 grid place-items-center"
        >
          <span className="grid size-16 place-items-center rounded-full bg-black/45 backdrop-blur-sm transition-transform hover:scale-105">
            <Play className="size-7 translate-x-0.5 fill-white text-white" />
          </span>
        </button>
      ) : null}

      <ErrorVeil error={snapshot.error} onRetry={() => engine.retry()} />
      <GateVeil
        show={snapshot.gate.blocked}
        previewSeconds={snapshot.gate.previewSeconds}
        onUnlock={() => onUnlock?.()}
        onLogin={onLogin}
        loggedIn={loggedIn}
      />

      {/* 控制栏 */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-16 pb-2 transition-opacity duration-200',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <ProgressBar
          currentTime={snapshot.currentTime}
          duration={snapshot.duration}
          bufferedTo={snapshot.bufferedTo}
          previewLimit={snapshot.gate.previewSeconds}
          spriteCues={spriteCues}
          onSeek={(t) => engine.seek(t)}
          onScrubChange={setScrubbing}
        />

        <div className="flex items-center gap-1 pb-1 text-white">
          <ControlButton label={snapshot.paused ? '播放' : '暂停'} onClick={() => engine.togglePlay()}>
            {snapshot.paused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
          </ControlButton>

          {onNext ? (
            <ControlButton label="下一个" onClick={onNext}>
              <SkipForward className="size-5 fill-current" />
            </ControlButton>
          ) : null}

          {/* 音量：滑杆只在悬停时展开，收起时不占位置 */}
          <div className="group/vol flex items-center">
            <ControlButton label="静音" onClick={() => engine.toggleMute()}>
              <VolumeIcon className="size-5" />
            </ControlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={snapshot.muted ? 0 : snapshot.volume}
              onChange={(e) => engine.setVolume(Number(e.target.value))}
              aria-label="音量"
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <span className="ml-1 text-[13px] tabular-nums text-white/85">
            {formatDuration(snapshot.currentTime)}
            <span className="mx-1 text-white/40">/</span>
            {formatDuration(snapshot.duration)}
          </span>

          <div className="flex-1" />

          {title ? (
            <span className="mr-2 max-w-[38%] truncate text-[13px] text-white/60">{title}</span>
          ) : null}

          {/* 字幕：没轨就不露按钮，避免空菜单 */}
          {hasCaptions ? (
            <Menu
              open={menu === 'captions'}
              onOpenChange={(open) => setMenu(open ? 'captions' : 'none')}
              trigger={
                <ControlButton label="字幕" asSpan>
                  <Captions className="size-5" />
                </ControlButton>
              }
            >
              <MenuItem
                active={captions.selected === 'off'}
                onClick={() => {
                  captions.setSelected('off');
                  setMenu('none');
                }}
              >
                关闭
              </MenuItem>
              {(playerOptions.source?.captions ?? []).map((track) => (
                <MenuItem
                  key={track.lang}
                  active={captions.selected === track.lang}
                  onClick={() => {
                    captions.setSelected(track.lang);
                    setMenu('none');
                  }}
                >
                  {captions.labelFor(track.lang)}
                </MenuItem>
              ))}
            </Menu>
          ) : null}

          {/* 倍速 */}
          <Menu
            open={menu === 'rate'}
            onOpenChange={(open) => setMenu(open ? 'rate' : 'none')}
            trigger={
              <ControlButton label="播放速度" asSpan>
                <Gauge className="size-5" />
                {snapshot.playbackRate !== 1 ? (
                  <span className="ml-1 text-xs font-semibold tabular-nums">{snapshot.playbackRate}x</span>
                ) : null}
              </ControlButton>
            }
          >
            {PLAYBACK_RATES.map((rate) => (
              <MenuItem
                key={rate}
                active={snapshot.playbackRate === rate}
                onClick={() => {
                  engine.setRate(rate);
                  setMenu('none');
                }}
              >
                {rate === 1 ? '正常' : `${rate}x`}
              </MenuItem>
            ))}
          </Menu>

          {/* 清晰度 */}
          {snapshot.levels.length > 0 ? (
            <Menu
              open={menu === 'quality'}
              onOpenChange={(open) => setMenu(open ? 'quality' : 'none')}
              trigger={
                <ControlButton label="清晰度" asSpan>
                  <Settings className="size-5" />
                  <span className="ml-1 text-xs font-medium">{currentQualityLabel}</span>
                </ControlButton>
              }
            >
              <MenuItem
                active={snapshot.autoQuality}
                onClick={() => {
                  engine.setLevel(-1);
                  setMenu('none');
                }}
              >
                自动
              </MenuItem>
              {[...snapshot.levels]
                .sort((a, b) => b.height - a.height)
                .map((level) => (
                  <MenuItem
                    key={level.index}
                    active={!snapshot.autoQuality && snapshot.selectedLevel === level.index}
                    onClick={() => {
                      engine.setLevel(level.index);
                      setMenu('none');
                    }}
                  >
                    {level.label}
                  </MenuItem>
                ))}
            </Menu>
          ) : null}

          {snapshot.pipSupported ? (
            <ControlButton label="画中画" onClick={() => void engine.togglePip()}>
              <PictureInPicture2 className="size-5" />
            </ControlButton>
          ) : null}

          <ControlButton
            label={snapshot.isFullscreen ? '退出全屏' : '全屏'}
            onClick={() => void engine.toggleFullscreen(containerRef.current)}
          >
            {snapshot.isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  children,
  onClick,
  asSpan = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  asSpan?: boolean;
}) {
  const className =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-white/90 transition-colors hover:bg-white/15 hover:text-white';
  if (asSpan) {
    return (
      <span className={className} aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={className}>
      {children}
    </button>
  );
}

function Menu({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => onOpenChange(!open)} className="block">
        {trigger}
      </button>
      {open ? (
        <div className="absolute right-0 bottom-full mb-2 min-w-28 overflow-hidden rounded-xl bg-black/90 p-1 shadow-lg backdrop-blur-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
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
        'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-white/15 font-medium text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
      {active ? <span className="size-1.5 rounded-full bg-white" /> : null}
    </button>
  );
}
