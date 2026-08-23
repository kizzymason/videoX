export function formatYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 大额金额在窄屏上会撑破卡片，超过一万折成「万」。 */
export function formatYuanCompact(cents: number): string {
  const yuan = cents / 100;
  if (Math.abs(yuan) >= 10_000) return `¥${(yuan / 10_000).toFixed(2)}万`;
  if (Math.abs(yuan) >= 1000) return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatFullDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 图表横轴：只保留「月/日」，YYYY-MM-DD 在 375px 宽度下必然重叠。 */
export function shortDate(value: string): string {
  const parts = value.split('-');
  if (parts.length < 3) return value;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export interface Delta {
  ratio: number;
  up: boolean;
  text: string;
}

/** 环比：上一个等长区间为 0 时不编造百分比，直接显示「新增」。 */
export function computeDelta(current: number, previous: number): Delta | null {
  if (previous === 0) {
    if (current === 0) return null;
    return { ratio: 1, up: true, text: '新增' };
  }
  const ratio = (current - previous) / previous;
  if (ratio === 0) return { ratio, up: true, text: '持平' };
  return { ratio, up: ratio > 0, text: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(1)}%` };
}

export function todayLabel(): string {
  return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
}
