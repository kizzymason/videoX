import type { PlayerEngine } from './engine.js';

export interface HotkeyContext {
  engine: PlayerEngine;
  container: HTMLElement | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * 快捷键。绑在 document 上而不是播放器容器上——用户滚到评论区再按空格
 * 依然应该能暂停，这是长视频站的默认预期。输入框内则一律放行。
 */
export function bindHotkeys(ctx: HotkeyContext): () => void {
  const handler = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const { engine } = ctx;
    const snap = engine.getSnapshot();

    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        event.preventDefault();
        engine.togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        engine.seekBy(-5);
        break;
      case 'ArrowRight':
        event.preventDefault();
        engine.seekBy(5);
        break;
      case 'j':
      case 'J':
        event.preventDefault();
        engine.seekBy(-10);
        break;
      case 'l':
      case 'L':
        event.preventDefault();
        engine.seekBy(10);
        break;
      case 'ArrowUp':
        event.preventDefault();
        engine.setVolume(snap.volume + 0.1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        engine.setVolume(snap.volume - 0.1);
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        engine.toggleMute();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        void engine.toggleFullscreen(ctx.container);
        break;
      case 'p':
      case 'P':
        event.preventDefault();
        void engine.togglePip();
        break;
      case '>':
        event.preventDefault();
        engine.setRate(Math.min(3, snap.playbackRate + 0.25));
        break;
      case '<':
        event.preventDefault();
        engine.setRate(Math.max(0.5, snap.playbackRate - 0.25));
        break;
      default:
        // 数字键跳转到对应百分比位置。
        if (/^[0-9]$/.test(event.key) && snap.duration > 0) {
          event.preventDefault();
          engine.seek((snap.duration * Number(event.key)) / 10);
        }
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
