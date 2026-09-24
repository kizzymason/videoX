import * as React from 'react';
import {
  CONSOLE_SHIELD_INTERVAL_MS,
  CONSOLE_SHIELD_SETTLE_MS,
  createConsoleShieldProbe,
} from '@videox/shared';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'videox:theme';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/**
 * 主题切换。默认值由站点设置注入（后台「默认主题」），用户手动切换后落 localStorage 覆盖。
 * 首帧闪白的问题交给各端 index.html 里的内联脚本处理，这里只负责后续切换。
 */
export function useTheme(defaultMode: ThemeMode = 'system') {
  const [mode, setMode] = React.useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return defaultMode;
    return (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? defaultMode;
  });

  React.useEffect(() => {
    applyTheme(resolveTheme(mode));
    if (mode === 'system') {
      localStorage.removeItem(THEME_KEY);
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applyTheme(resolveTheme('system'));
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    localStorage.setItem(THEME_KEY, mode);
    return undefined;
  }, [mode]);

  return { mode, setMode, resolved: resolveTheme(mode) } as const;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** 触底加载：把返回的 ref 挂在列表末尾的哨兵元素上。 */
export function useInfiniteSentinel(
  onIntersect: () => void,
  options: { enabled?: boolean; rootMargin?: string } = {},
) {
  const { enabled = true, rootMargin = '600px' } = options;
  const callbackRef = React.useRef(onIntersect);
  callbackRef.current = onIntersect;

  const [node, setNode] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!node || !enabled) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callbackRef.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled, rootMargin]);

  return setNode;
}

/** 元素是否进入视口，用于图片懒加载与卡片悬停预取的可见性判断。 */
export function useInView<T extends HTMLElement>(options: IntersectionObserverInit = {}) {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), options);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.root, options.rootMargin, options.threshold]);

  return [ref, inView] as const;
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 隐私模式下写入会抛错，忽略即可 */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/**
 * 防窥：拦右键、拖拽与常见的调试快捷键。
 *
 * 边界要说清楚：浏览器层面无法真正禁用 devtools，这里只提高随手偷看的成本，
 * 真正的防线在服务端（密文存储、订单归属校验、密钥不出后端）。
 * 输入框与文本复制仍要能用，所以不拦 selectstart，禁选交给容器上的 CSS。
 * 局部要放开长按/右键（比如付款二维码）时，在该元素上 stopPropagation 即可。
 */
export type BrowseMode = 'paged' | 'infinite';

const BROWSE_KEY = 'videox:browse-mode';

function parseBrowseMode(raw: string | null): BrowseMode | null {
  return raw === 'paged' || raw === 'infinite' ? raw : null;
}

/**
 * 浏览模式是跨子树共享的状态：顶栏开关和各列表页不在同一棵 React 树里，
 * 只用组件内 state + localStorage 的话，切换后列表要整页刷新才生效。
 * 所以放一个模块级订阅，谁改都能立刻通知到所有列表。
 */
let browseOverride: BrowseMode | null = null;
let browseLoaded = false;
const browseListeners = new Set<() => void>();

function browseSnapshot(): BrowseMode | null {
  if (!browseLoaded) {
    browseOverride = typeof window === 'undefined' ? null : parseBrowseMode(localStorage.getItem(BROWSE_KEY));
    browseLoaded = true;
  }
  return browseOverride;
}

function subscribeBrowse(onChange: () => void) {
  browseListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== BROWSE_KEY) return;
    browseOverride = parseBrowseMode(event.newValue);
    browseLoaded = true;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    browseListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function writeBrowseMode(next: BrowseMode) {
  browseLoaded = true;
  if (browseOverride === next) return;
  browseOverride = next;
  try {
    localStorage.setItem(BROWSE_KEY, next);
  } catch {
    /* 隐私模式写不进去就算了，本次会话内仍然生效 */
  }
  for (const listener of browseListeners) listener();
}

/**
 * 视频列表浏览模式。用户点过顶栏开关后写 localStorage；
 * 没选过则跟随后台 defaultBrowseMode（默认分页）。
 */
export function useBrowseMode(siteDefault: BrowseMode = 'paged') {
  const override = React.useSyncExternalStore(subscribeBrowse, browseSnapshot, () => null);
  const mode = override ?? siteDefault;

  const setMode = React.useCallback((next: BrowseMode) => writeBrowseMode(next), []);
  const toggle = React.useCallback(() => {
    writeBrowseMode(mode === 'paged' ? 'infinite' : 'paged');
  }, [mode]);

  return { mode, setMode, toggle } as const;
}

function isViteDev(): boolean {
  try {
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

/**
 * 播放页控台劝退。开 DevTools 后返回 true，由页面卸播放器、清票据。
 * 不拦右键、不拦选中——和订阅页 useAntiPeek 刻意分开。
 * 浏览器关不掉控制台，尺寸差 + 调试器耗时只提高随手偷看的成本。
 *
 * 判定策略本身在 `@videox/shared` 的 console-shield.ts 里，这里只负责
 * 按节拍喂样本：读环境 → 采一次样 → 交给 probe 决定要不要劝退。
 * 拆开是为了能写单测——这套规则过去只在真机旋屏时才暴露误杀。
 */
export function useConsoleShield(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [tripped, setTripped] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || tripped) return undefined;
    if (isViteDev()) return undefined;

    const probe = createConsoleShieldProbe({
      coarsePointer:
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
      maxTouchPoints: navigator.maxTouchPoints || 0,
    });

    const trip = () => setTripped(true);

    const sample = () => {
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const debuggerCostMs = performance.now() - start;

      if (
        probe.sample({
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          fullscreen: Boolean(document.fullscreenElement),
          debuggerCostMs,
        })
      ) {
        trip();
      }
    };

    // 旋屏、拖动窗口、进出全屏都会让尺寸连续抖动，抖完再判。
    let settleTimer: number | undefined;
    const onViewportChange = () => {
      probe.invalidate();
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        sample();
      }, CONSOLE_SHIELD_SETTLE_MS);
    };

    sample();
    const timer = window.setInterval(sample, CONSOLE_SHIELD_INTERVAL_MS);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    document.addEventListener('fullscreenchange', onViewportChange);

    return () => {
      window.clearInterval(timer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      document.removeEventListener('fullscreenchange', onViewportChange);
    };
  }, [enabled, tripped]);

  return tripped;
}

export function useAntiPeek(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;

  React.useEffect(() => {
    if (!enabled) return undefined;

    const block = (e: Event) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (key === 'f12' || (mod && e.shiftKey && (key === 'i' || key === 'j' || key === 'c'))) {
        e.preventDefault();
        return;
      }
      if (mod && (key === 'u' || key === 's' || key === 'p')) e.preventDefault();
    };

    document.addEventListener('contextmenu', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled]);
}

/** 复制到剪贴板，返回的 copied 会在 2s 后自动复位。 */
export function useCopy(resetAfter = 2000) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), resetAfter);
    },
    [resetAfter],
  );
  return { copied, copy } as const;
}
