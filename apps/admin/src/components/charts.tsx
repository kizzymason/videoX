import type * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BreakdownItem, TrendPoint } from '@videox/shared';
import { cn } from '@videox/ui';
import { formatNumber, shortDate } from '../lib/format';

/** 单色梯度：设计基调是黑白，图表也别乱用彩虹色，靠透明度分层。 */
export const MONO = ['oklch(0.22 0.004 285)', 'oklch(0.42 0.004 285)', 'oklch(0.58 0.004 285)', 'oklch(0.72 0.003 285)', 'oklch(0.84 0.002 285)'];

const AXIS = { stroke: 'transparent', tickLine: false, axisLine: false } as const;

/** recharts 的 Formatter 签名把 value 放宽成 ValueType|undefined，这里统一收敛回数字。 */
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

export interface TrendSeries {
  key: keyof TrendPoint & string;
  label: string;
  /** 收入是分，展示要除 100 */
  transform?: (value: number) => number;
  format?: (value: number) => string;
}

export function TrendAreaChart({
  data,
  series,
  height = 260,
}: {
  data: TrendPoint[];
  series: TrendSeries[];
  height?: number;
}) {
  const rows = data.map((point) => {
    const row: Record<string, string | number> = { date: point.date };
    for (const s of series) {
      const raw = Number(point[s.key] ?? 0);
      row[s.label] = s.transform ? s.transform(raw) : raw;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.label} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={MONO[i % MONO.length]} stopOpacity={0.24} />
              <stop offset="100%" stopColor={MONO[i % MONO.length]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
        <YAxis width={56} tickFormatter={(v: number) => compact(v)} {...AXIS} />
        <Tooltip
          formatter={(value, name) => {
            const s = series.find((item) => item.label === name);
            return [s?.format ? s.format(num(value)) : formatNumber(num(value)), String(name)];
          }}
        />
        {series.map((s, i) => (
          <Area
            key={s.label}
            type="monotone"
            dataKey={s.label}
            stroke={MONO[i % MONO.length]}
            strokeWidth={1.8}
            fill={`url(#grad-${s.key})`}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MiniLine({ values, className }: { values: number[]; className?: string }) {
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div className={cn('h-9 w-24', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke={MONO[0]} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 横向条形榜：来源/设备/地域这类维度用它，比饼图好读。 */
export function BreakdownBars({ items, empty = '暂无数据' }: { items: BreakdownItem[]; empty?: string }) {
  if (items.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.slice(0, 8).map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{item.label || '未知'}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(item.value)}
              <span className="ml-1.5 text-muted-foreground/70">{(item.percent * 100).toFixed(1)}%</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground/75" style={{ width: `${Math.max(item.percent * 100, 1.5)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DonutChart({ items, height = 180 }: { items: BreakdownItem[]; height?: number }) {
  if (items.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">暂无数据</p>;
  const rows = items.slice(0, 5).map((item) => ({ name: item.label || '未知', value: item.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} stroke="none">
          {rows.map((_, i) => (
            <Cell key={i} fill={MONO[i % MONO.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => formatNumber(num(value))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RetentionChart({
  data,
  height = 200,
}: {
  data: { bucket: number; percentOfViewers: number }[];
  height?: number;
}) {
  const rows = data.map((d) => ({ bucket: `${d.bucket}%`, value: Math.round(d.percentOfViewers * 100) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
        <XAxis dataKey="bucket" interval={Math.max(0, Math.floor(rows.length / 10) - 1)} {...AXIS} />
        <YAxis width={44} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} {...AXIS} />
        <Tooltip formatter={(value) => [`${num(value)}% 观众`, '留存']} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {rows.map((row, i) => (
            // 留存越低越浅，一眼看出流失拐点
            <Cell key={i} fill={`oklch(0.22 0.004 285 / ${0.25 + (row.value / 100) * 0.75})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
