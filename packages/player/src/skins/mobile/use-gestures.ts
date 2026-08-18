import * as React from 'react';
import type { PlayerEngine } from '../../core/engine.js';

export type GestureHint =
  | { kind: 'none' }
  | { kind: 'seek'; delta: number; direction: 'forward' | 'backward' }
  | { kind: 'volume'; value: number }
  | { kind: 'brightness'; value: number }
  | { kind: 'rate'; value: number }
  | { kind: 'scrub'; time: number; delta: number };

interface Options {
  engine: PlayerEngine;
  onTap: () => void;
  /** 亮度是软件模拟的：Web 拿不到系统亮度，用一层黑色蒙版压暗 */
  brightness: number;
  setBrightness: (value: number) => void;
  disabled?: boolean;
}

const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 420;
const DRAG_THRESHOLD = 12;

/**
 * 移动端手势。刻意只实现四种大家肌肉记忆里已有的：
 * 双击左右快退快进、左半屏竖滑调亮度、右半屏竖滑调音量、长按 2 倍速。
 * 横向滑动做进度预览（松手才 seek），跟进度条的行为保持一致。
 */
export function useGestures({ engine, onTap, brightness, setBrightness, disabled }: Options) {
  const [hint, setHint] = React.useState<GestureHint>({ kind: 'none' });

  const state = React.useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    startVolume: 0,
    startBrightness: 1,
    startedAt: 0,
    mode: 'idle' as 'idle' | 'pending' | 'seek' | 'volume' | 'brightness' | 'longpress',
    lastTapAt: 0,
    lastTapX: 0,
    longPressTimer: null as ReturnType<typeof setTimeout> | null,
    savedRate: 1,
    width: 0,
  });

  const clearHint = React.useCallback(() => {
    setHint({ kind: 'none' });
  }, []);

  const scheduleHintClear = React.useCallback(() => {
    setTimeout(clearHint, 700);
  }, [clearHint]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const s = state.current;
    const snap = engine.getSnapshot();

    s.startX = event.clientX;
    s.startY = event.clientY;
    s.startTime = snap.currentTime;
    s.startVolume = snap.muted ? 0 : snap.volume;
    s.startBrightness = brightness;
    s.startedAt = Date.now();
    s.mode = 'pending';
    s.width = rect.width;
    s.savedRate = snap.playbackRate;

    s.longPressTimer = setTimeout(() => {
      if (s.mode !== 'pending') return;
      s.mode = 'longpress';
      engine.setRate(2);
      setHint({ kind: 'rate', value: 2 });
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'mouse') return;
    const s = state.current;
    if (s.mode === 'idle' || s.mode === 'longpress') return;

    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;

    if (s.mode === 'pending') {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (s.longPressTimer) clearTimeout(s.longPressTimer);
      if (Math.abs(dx) > Math.abs(dy)) {
        s.mode = 'seek';
      } else {
        s.mode = s.startX < s.width / 2 ? 'brightness' : 'volume';
      }
    }

    const rect = event.currentTarget.getBoundingClientRect();

    if (s.mode === 'seek') {
      const duration = engine.getSnapshot().duration || 0;
      // 横向滑满整屏 = 90 秒，比按比例映射更好控制长视频。
      const delta = (dx / Math.max(1, s.width)) * 90;
      const target = Math.max(0, Math.min(duration, s.startTime + delta));
      setHint({ kind: 'scrub', time: target, delta });
      return;
    }

    // 竖向滑满整屏正好从 0 到 1。
    const ratio = -dy / Math.max(1, rect.height);
    if (s.mode === 'volume') {
      const value = Math.max(0, Math.min(1, s.startVolume + ratio));
      engine.setVolume(value);
      setHint({ kind: 'volume', value });
    } else if (s.mode === 'brightness') {
      const value = Math.max(0.2, Math.min(1, s.startBrightness + ratio));
      setBrightness(value);
      setHint({ kind: 'brightness', value });
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'mouse') return;
    const s = state.current;
    if (s.longPressTimer) clearTimeout(s.longPressTimer);

    if (s.mode === 'longpress') {
      engine.setRate(s.savedRate);
      s.mode = 'idle';
      clearHint();
      return;
    }

    if (s.mode === 'seek') {
      const dx = event.clientX - s.startX;
      const delta = (dx / Math.max(1, s.width)) * 90;
      engine.seek(s.startTime + delta);
      s.mode = 'idle';
      scheduleHintClear();
      return;
    }

    if (s.mode === 'volume' || s.mode === 'brightness') {
      s.mode = 'idle';
      scheduleHintClear();
      return;
    }

    // 没有位移也没到长按时长，按点击处理。
    const now = Date.now();
    const isDoubleTap = now - s.lastTapAt < DOUBLE_TAP_MS && Math.abs(event.clientX - s.lastTapX) < 60;
    s.mode = 'idle';

    if (isDoubleTap) {
      s.lastTapAt = 0;
      const forward = event.clientX > s.width / 2;
      engine.seekBy(forward ? 10 : -10);
      setHint({ kind: 'seek', delta: 10, direction: forward ? 'forward' : 'backward' });
      scheduleHintClear();
      return;
    }

    s.lastTapAt = now;
    s.lastTapX = event.clientX;
    // 等一个双击窗口再判定为单击，否则双击会连带触发一次控件开合。
    setTimeout(() => {
      if (state.current.lastTapAt === now) onTap();
    }, DOUBLE_TAP_MS);
  };

  const onPointerCancel = () => {
    const s = state.current;
    if (s.longPressTimer) clearTimeout(s.longPressTimer);
    if (s.mode === 'longpress') engine.setRate(s.savedRate);
    s.mode = 'idle';
    clearHint();
  };

  React.useEffect(() => {
    return () => {
      if (state.current.longPressTimer) clearTimeout(state.current.longPressTimer);
    };
  }, []);

  return {
    hint,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  } as const;
}
