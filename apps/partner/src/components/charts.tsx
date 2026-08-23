import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PartnerCandle, PartnerLabeledCount, PartnerTrendPoint } from '@videox/shared';
import { cn } from '@videox/ui';
import { formatNumber, formatYuan, shortDate } from '../lib/format';

/**
 * 图表配色跟着「白底 + 近黑强调」走：主序列用近黑，辅助序列靠灰阶拉开，
 * 只有 K 线的涨跌用红绿（国内习惯），避免整屏花掉。
 */
const INK = 'oklch(0.17 0.004 285)';
const INK_60 = 'oklch(0.52 0.006 285)';
const INK_35 = 'oklch(0.72 0.004 285)';
const UP = 'oklch(0.58 0.19 25)';
const DOWN = 'oklch(0.6 0.13 155)';

export const CHART_INK = INK;

const AXIS = { stroke: 'transparent', tickLine: false, axisLine: false } as const;

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

function compact(value: number): string {
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
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
    <section className={cn('pt-card p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface TrendSeries {
  key: keyof PartnerTrendPoint & string;
  label: string;
  transform?: (value: number) => number;
  format?: (value: number) => string;
}

export function TrendAreaChart({
  data,
  series,
  height = 200,
}: {
  data: PartnerTrendPoint[];
  series: TrendSeries[];
  height?: number;
}) {
  const rows = data.map((point) => {
    const row: Record<string, string | number> = { date: point.date };
    for (const item of series) {
      const raw = Number(point[item.key] ?? 0);
      row[item.label] = item.transform ? item.transform(raw) : raw;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
        <defs>
          {series.map((item, i) => (
            <linearGradient key={item.label} id={`pt-grad-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={i === 0 ? INK : INK_60} stopOpacity={0.22} />
              <stop offset="100%" stopColor={i === 0 ? INK : INK_60} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={26} {...AXIS} />
        <YAxis width={44} tickFormatter={(v: number) => compact(v)} allowDecimals={false} {...AXIS} />
        <Tooltip
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value, name) => {
            const item = series.find((s) => s.label === name);
            return [item?.format ? item.format(num(value)) : formatNumber(num(value)), String(name)];
          }}
        />
        {series.map((item, i) => (
          <Area
            key={item.label}
            type="monotone"
            dataKey={item.label}
            stroke={i === 0 ? INK : INK_60}
            strokeWidth={i === 0 ? 1.8 : 1.2}
            strokeDasharray={i === 0 ? undefined : '4 3'}
            fill={`url(#pt-grad-${item.key})`}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandleRow;
}

interface CandleRow {
  label: string;
  range: [number, number];
  open: number;
  close: number;
  volume: number;
  date: string;
  endDate: string;
}

/**
 * recharts 没有蜡烛图元件。这里借「区间柱」拿到 low→high 的像素范围，
 * 再线性插值算出开收盘的位置，自绘影线 + 实体。
 */
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) return null;
  const [low, high] = payload.range;
  const rising = payload.close >= payload.open;
  const color = rising ? UP : DOWN;
  const span = high - low;
  const yOf = (value: number) => (span <= 0 ? y + height / 2 : y + ((high - value) / span) * height);

  const bodyTop = yOf(Math.max(payload.open, payload.close));
  const bodyBottom = yOf(Math.min(payload.open, payload.close));
  const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
  const bodyWidth = Math.max(3, Math.min(width * 0.62, 14));
  const center = x + width / 2;

  return (
    <g>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect
        x={center - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={1.5}
        fill={rising ? color : 'white'}
        stroke={color}
        strokeWidth={1.2}
      />
    </g>
  );
}

/** 收入 K 线 + 成交量。空数据时交给调用方渲染空态。 */
export function CandleChart({ candles, height = 208 }: { candles: PartnerCandle[]; height?: number }) {
  const rows: CandleRow[] = candles.map((candle) => ({
    label: shortDate(candle.date),
    range: [candle.low, candle.high],
    open: candle.open,
    close: candle.close,
    volume: candle.volume,
    date: candle.date,
    endDate: candle.endDate,
  }));

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
          <XAxis dataKey="label" {...AXIS} minTickGap={18} />
          <YAxis width={48} tickFormatter={(v: number) => compact(v / 100)} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'oklch(0.17 0.004 285 / 0.04)' }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as CandleRow | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] shadow-[var(--shadow-pop)]">
                  <p className="mb-1 font-medium">
                    {shortDate(row.date)} – {shortDate(row.endDate)}
                  </p>
                  <p className="text-muted-foreground">开 {formatYuan(row.open)}</p>
                  <p className="text-muted-foreground">收 {formatYuan(row.close)}</p>
                  <p className="text-muted-foreground">
                    高 {formatYuan(row.range[1])} / 低 {formatYuan(row.range[0])}
                  </p>
                  <p className="text-muted-foreground">激活 {row.volume} 张</p>
                </div>
              );
            }}
          />
          <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={44}>
        <BarChart data={rows} margin={{ top: 0, right: 4, left: -14, bottom: 0 }}>
          <YAxis width={48} hide />
          <XAxis dataKey="label" hide />
          <Bar dataKey="volume" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {rows.map((row, i) => (
              <Cell key={i} fill={row.close >= row.open ? `${UP}` : `${DOWN}`} fillOpacity={0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({
  values,
  className,
  tone = 'ink',
}: {
  values: number[];
  className?: string;
  tone?: 'ink' | 'invert';
}) {
  const rows = values.map((v, i) => ({ i, v }));
  const stroke = tone === 'invert' ? 'oklch(0.99 0 0)' : INK;
  return (
    <div className={cn('h-8 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`pt-spark-${tone}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={tone === 'invert' ? 0.35 : 0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#pt-spark-${tone})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div className={cn('h-8 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Bar dataKey="v" fill={INK_35} radius={[1.5, 1.5, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniLine({ values, className }: { values: number[]; className?: string }) {
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div className={cn('h-8 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Line type="monotone" dataKey="v" stroke={INK_60} strokeWidth={1.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 配额环：单值仪表，中间放百分比。 */
export function QuotaGauge({
  used,
  total,
  label,
  caption,
  size = 128,
}: {
  used: number;
  total: number;
  label: string;
  caption: string;
  size?: number;
}) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const rows = [{ name: label, value: Math.round(ratio * 100), fill: INK }];
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={rows}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={9}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar background={{ fill: 'oklch(0.93 0.003 285)' }} dataKey="value" cornerRadius={9} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-lg font-semibold tabular-nums leading-none">{Math.round(ratio * 100)}%</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{label}</p>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">{caption}</p>
    </div>
  );
}

export function WeekdayRadar({ data, height = 190 }: { data: PartnerLabeledCount[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="oklch(0.9 0.003 285)" />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: 'oklch(0.55 0.008 285)' }} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <Radar dataKey="value" stroke={INK} strokeWidth={1.4} fill={INK} fillOpacity={0.12} isAnimationActive={false} />
        <Tooltip formatter={(value) => [`${formatNumber(num(value))} 次激活`, '']} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/** 横向条形榜：到期分布、卡密状态这类少量分类维度用它，比饼图好读。 */
export function BarList({
  items,
  total,
  empty = '暂无数据',
  highlight,
  unit = '',
}: {
  items: PartnerLabeledCount[];
  total?: number;
  empty?: string;
  /** 需要提醒的分类（如「已到期」）用红色条 */
  highlight?: string[];
  unit?: string;
}) {
  const sum = total ?? items.reduce((acc, item) => acc + item.value, 0);
  if (sum === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const percent = sum > 0 ? item.value / sum : 0;
        const warn = highlight?.includes(item.label);
        return (
          <li key={item.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatNumber(item.value)}
                {unit}
                <span className="ml-1.5 text-muted-foreground">{(percent * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', warn ? 'bg-up' : 'bg-foreground/80')}
                style={{ width: `${Math.max(percent * 100, item.value > 0 ? 3 : 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
