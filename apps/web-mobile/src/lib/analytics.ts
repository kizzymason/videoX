import type { AnalyticsPayload } from '@videox/shared';

const SESSION_KEY = 'videox:sid';
const VISITOR_KEY = 'videox:vid';
const FLUSH_INTERVAL = 8000;
const MAX_BATCH = 50;

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uid();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function visitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = uid();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function readUtm(): Record<string, string> | undefined {
  const params = new URLSearchParams(location.search);
  const utm: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = params.get(key);
    if (value) utm[key.replace('utm_', '')] = value;
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

let queue: AnalyticsPayload[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const endpoint = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/collect`;

function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ events });

  // 页面卸载时 fetch 会被中断，只有 sendBeacon 能保证把最后一批发出去。
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'include',
    keepalive: true,
  }).catch(() => undefined);
}

/** 埋点上报。攒批发送，避免每个交互一个请求把接口打满。 */
export function track(
  event: AnalyticsPayload['event'],
  extra: Partial<Omit<AnalyticsPayload, 'event' | 'sessionId' | 'visitorId' | 'client' | 'ts'>> = {},
): void {
  queue.push({
    event,
    sessionId: sessionId(),
    visitorId: visitorId(),
    path: location.pathname,
    referrer: document.referrer || undefined,
    utm: readUtm(),
    screen: { w: window.screen.width, h: window.screen.height },
    client: 'mobile',
    ts: Date.now(),
    ...extra,
  });

  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  timer ??= setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_INTERVAL);
}

export function initAnalytics(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}
