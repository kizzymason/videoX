import * as React from 'react';
import { PlayerEngine } from '../core/engine.js';
import { bindHotkeys } from '../core/hotkeys.js';
import { loadSpriteCues } from '../core/sprites.js';
import type { PlayerEngineOptions, PlayerSnapshot, PlayerSource, SpriteCue } from '../types.js';

export interface UsePlayerResult {
  engine: PlayerEngine;
  snapshot: PlayerSnapshot;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  spriteCues: SpriteCue[];
}

export interface UsePlayerOptions extends PlayerEngineOptions {
  source: PlayerSource | null;
  /** 关闭后需要自己调 bindHotkeys，移动端默认不需要 */
  hotkeys?: boolean;
}

/**
 * 把 engine 接进 React。engine 本身是命令式的，这里只负责生命周期与订阅，
 * 状态走 useSyncExternalStore——播放器每秒几十次 timeupdate，用 setState 会把
 * 整棵子树的 diff 成本抬得很难看。
 */
export function usePlayer(options: UsePlayerOptions): UsePlayerResult {
  const { source, hotkeys = true, ...engineOptions } = options;

  const optionsRef = React.useRef(engineOptions);
  optionsRef.current = engineOptions;

  // 首次渲染时有没有 renewTicket 决定了引擎要不要排续签定时器，后续只透传调用。
  const renewable = React.useRef(Boolean(engineOptions.renewTicket));

  const [engine] = React.useState(
    () =>
      new PlayerEngine({
        renewTicket: renewable.current
          ? async (id) => {
              const fn = optionsRef.current.renewTicket;
              if (!fn) throw new Error('renewTicket 未提供');
              return fn(id);
            }
          : undefined,
        onProgress: (p, d) => optionsRef.current.onProgress?.(p, d),
        onGate: () => optionsRef.current.onGate?.(),
        onEnded: () => optionsRef.current.onEnded?.(),
        onError: (e) => optionsRef.current.onError?.(e),
        onFirstFrame: (ms) => optionsRef.current.onFirstFrame?.(ms),
        progressIntervalMs: engineOptions.progressIntervalMs,
        startLevelMaxHeight: engineOptions.startLevelMaxHeight,
        autoplay: engineOptions.autoplay,
        muted: engineOptions.muted,
      }),
  );

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const snapshot = React.useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  React.useEffect(() => () => engine.destroy(), [engine]);

  React.useEffect(() => {
    if (!videoRef.current || !source) return;
    engine.attach(videoRef.current);
    engine.load(source);
    // 只认 videoId + masterUrl：票据续签换 token 不应该重新加载整个流。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, source?.videoId, source?.masterUrl]);

  React.useEffect(() => {
    if (!hotkeys) return undefined;
    return bindHotkeys({ engine, container: containerRef.current });
  }, [engine, hotkeys]);

  const [spriteCues, setSpriteCues] = React.useState<SpriteCue[]>([]);
  React.useEffect(() => {
    const url = source?.spriteVttUrl;
    if (!url) {
      setSpriteCues([]);
      return undefined;
    }
    const controller = new AbortController();
    loadSpriteCues(url, controller.signal)
      .then(setSpriteCues)
      .catch(() => setSpriteCues([]));
    return () => controller.abort();
  }, [source?.spriteVttUrl]);

  return { engine, snapshot, videoRef, containerRef, spriteCues };
}
