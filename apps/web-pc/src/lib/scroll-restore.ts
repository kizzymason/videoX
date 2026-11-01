import * as React from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 记住每个历史条目的滚动位置。
 *
 * 浏览器自带的 scrollRestoration 在 SPA 里不可靠：路由切换时内容还没渲染完，
 * 它按当时的高度去恢复，结果总是弹回顶部；列表页还会因为数据重新拉取而变矮。
 * 所以这里按 location.key（每个历史条目唯一）记位置，返回（POP）时自己恢复。
 *
 * PC 的滚动容器是 window（AppShell 里没有内层滚动区）。
 */

const positions = new Map<string, number>();

/**
 * 内容异步渲染：刚返回时列表可能还是骨架屏，页面高度不足以撑到目标位置，
 * 直接 scrollTo 会被夹到当前最大高度。所以在一个时间窗内持续纠正，
 * 一旦高度够了就停；用户自己一滚（wheel/触摸/键盘）立刻放弃，不跟人抢。
 */
function restoreWindow(target: number) {
  const deadline = performance.now() + 8000;
  let done = false;
  let observer: ResizeObserver | null = null;

  const stop = () => {
    done = true;
    observer?.disconnect();
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('keydown', stop);
  };

  const attempt = () => {
    if (done) return;
    window.scrollTo(0, target);
    if (Math.abs(window.scrollY - target) <= 2 || performance.now() > deadline) stop();
  };

  // 列表是异步铺开的：高度一涨就再对一次，比固定重试次数可靠。
  observer = new ResizeObserver(attempt);
  observer.observe(document.body);

  // 用户自己一动就放手，别跟人抢滚动。
  window.addEventListener('wheel', stop, { passive: true, once: true });
  window.addEventListener('touchstart', stop, { passive: true, once: true });
  window.addEventListener('keydown', stop, { once: true });

  requestAnimationFrame(attempt);
}

export function useScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const keyRef = React.useRef(location.key);

  // 滚动只记在"当前条目"名下，跨条目互不影响。
  // 只在滚动事件里记实时值。不要放到"切换路由时再读 window.scrollY"——
  // 那一刻新页面已经渲染、文档变矮，读数会被浏览器夹到新页面的最大高度，
  // 存进去的就是错的位置（这正是最初"返回总是回到顶部附近"的原因）。
  React.useEffect(() => {
    const onScroll = () => positions.set(keyRef.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useLayoutEffect(() => {
    keyRef.current = location.key;
    if (navigationType !== 'POP') return;
    const saved = positions.get(location.key);
    if (saved !== undefined && saved > 0) restoreWindow(saved);
  }, [location.key, navigationType]);
}

/** 关掉浏览器原生恢复，避免和我们自己的一套打架。 */
export function disableNativeScrollRestoration() {
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
}
