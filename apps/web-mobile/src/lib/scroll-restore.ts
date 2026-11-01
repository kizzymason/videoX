import * as React from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 移动端的滚动位置记忆。
 *
 * 和 PC 不同：移动端整页不滚，滚动发生在每个页面自己的 `.tab-scroll` 容器里
 * （首页、播放页、评论抽屉都是这个类）。容器会随路由重新挂载，所以每次恢复
 * 都要重新查一次节点，不能缓存元素引用。
 */

const positions = new Map<string, number>();

function pageScroller(): HTMLElement | null {
  // 抽屉 / 弹层里的 .tab-scroll 也带这个类，但它们在 DOM 末尾，取第一个即可。
  return document.querySelector<HTMLElement>('.tab-scroll');
}

/**
 * 和 PC 一样：返回瞬间列表可能还没铺满，高度不够会被夹住，
 * 所以在一个时间窗内持续纠正；用户一碰就停手。
 */
function restore(target: number) {
  const deadline = performance.now() + 8000;
  let done = false;
  let observer: ResizeObserver | null = null;

  const stop = () => {
    done = true;
    observer?.disconnect();
    document.removeEventListener('touchstart', stop, true);
    document.removeEventListener('wheel', stop, true);
  };

  const attempt = () => {
    if (done) return;
    const el = pageScroller();
    if (!el) {
      if (performance.now() > deadline) stop();
      else requestAnimationFrame(attempt);
      return;
    }
    el.scrollTop = target;
    if (Math.abs(el.scrollTop - target) <= 2 || performance.now() > deadline) stop();
  };

  // 卡片是异步铺开的：容器高度一涨就再对一次。
  const el = pageScroller();
  if (el) {
    observer = new ResizeObserver(attempt);
    observer.observe(el.firstElementChild ?? el);
  }

  document.addEventListener('touchstart', stop, { capture: true, passive: true, once: true });
  document.addEventListener('wheel', stop, { capture: true, passive: true, once: true });

  requestAnimationFrame(attempt);
}

export function useScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const keyRef = React.useRef(location.key);

  React.useEffect(() => {
    // scroll 不冒泡，用捕获阶段拿容器上的滚动。
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains('tab-scroll')) {
        positions.set(keyRef.current, target.scrollTop);
      }
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  // 同 PC：只信滚动事件里的实时值。切路由后再读 scrollTop，
  // 读到的已经是新页面（内容更矮）被夹住的值。
  React.useLayoutEffect(() => {
    keyRef.current = location.key;
    if (navigationType !== 'POP') return;
    const saved = positions.get(location.key);
    if (saved !== undefined && saved > 0) restore(saved);
  }, [location.key, navigationType]);
}

export function disableNativeScrollRestoration() {
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
}
