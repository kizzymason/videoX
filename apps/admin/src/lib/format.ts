/** 后台里到处要用的格式化，集中一处避免各页面各写一版。 */

export function formatCents(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 把秒数说成人话：后台看的是「累计观看时长」，小时级别最直观。 */
export function formatWatchTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  const hours = seconds / 3600;
  if (hours < 1000) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours).toLocaleString('zh-CN')} 小时`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, dateStyle: 'short', timeStyle: 'short' });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** 涨跌幅：deltas 是同比上一周期的增量，除以基数得到百分比。 */
export function formatDelta(current: number, delta: number): { text: string; up: boolean } | null {
  const previous = current - delta;
  if (previous <= 0) return delta > 0 ? { text: '新增', up: true } : null;
  const ratio = delta / previous;
  if (!Number.isFinite(ratio) || Math.abs(ratio) < 0.0001) return null;
  return { text: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%`, up: ratio > 0 };
}

/** 图表 X 轴：只保留 MM-DD，横轴才不会挤成一团。 */
export function shortDate(value: string): string {
  return value.slice(5, 10);
}
