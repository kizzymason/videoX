import * as React from 'react';

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
