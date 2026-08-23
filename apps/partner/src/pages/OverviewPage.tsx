import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  CalendarClock,
  ChevronRight,
  KeyRound,
  Lightbulb,
  Sparkles,
  TicketPercent,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Skeleton } from '@videox/ui';
import { partnerApi } from '../lib/api';
import { computeDelta, formatNumber, formatPercent, formatYuan, formatYuanCompact } from '../lib/format';
import { businessTip, timeGreeting } from '../lib/greeting';
import { BarList, CandleChart, ChartCard, MiniBars, Sparkline, TrendAreaChart, WeekdayRadar } from '../components/charts';
import { DeltaChip, InitialAvatar, Segmented, StatCard } from '../components/primitives';
import { ExpiryBadge } from '../components/ExpiryBadge';

const RANGES = [
  ['7', '近 7 天'],
  ['30', '近 30 天'],
  ['90', '近 90 天'],
] as const;

export function OverviewPage() {
  const [range, setRange] = React.useState<'7' | '30' | '90'>('30');
  const days = Number(range);

  const overview = useQuery({ queryKey: ['partner-overview'], queryFn: partnerApi.overview });
  const insights = useQuery({
    queryKey: ['partner-insights', days],
    queryFn: () => partnerApi.insights(days),
    placeholderData: keepPreviousData,
  });

  const data = overview.data;
  const stats = insights.data;
  const greeting = React.useMemo(() => timeGreeting(), []);
  const tip = businessTip(data);

  const revenueSeries = stats?.trend.map((point) => point.revenueCents / 100) ?? [];
  const activationSeries = stats?.trend.map((point) => point.activations) ?? [];
  const revenueDelta = stats ? computeDelta(stats.rangeRevenueCents, stats.prevRevenueCents) : null;
  const activationDelta = stats ? computeDelta(stats.rangeActivations, stats.prevActivations) : null;

  const totalCodes = data ? data.usedCodeCount + data.unusedCodeCount : 0;
  const conversion = totalCodes > 0 ? (data?.usedCodeCount ?? 0) / totalCodes : 0;
  const arpu = data && data.customerCount > 0 ? data.revenueCents / data.customerCount : 0;

  return (
    <div className="space-y-4">
      {/* 首屏只留一块深色卡：累计收入是合伙人最关心的数字，其余都用白卡承载。 */}
      <section className="pt-card-strong overflow-hidden p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] text-white/60">
              <Sparkles className="size-3.5" />
              {greeting.line}
            </p>
            <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-white/50">累计收入</p>
            {data ? (
              <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
                {formatYuan(data.revenueCents)}
              </p>
            ) : (
              <Skeleton className="mt-1 h-9 w-40 bg-white/10" />
            )}
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/12">
            <TrendingUp className="size-4.5" />
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/70">
          <DeltaChip delta={revenueDelta} invert />
          <span>
            近 {days} 天 {stats ? formatYuanCompact(stats.rangeRevenueCents) : '—'}
          </span>
        </div>

        <div className="-mx-1 mt-2 opacity-80">
          <Sparkline values={revenueSeries.length > 0 ? revenueSeries : [0, 0]} tone="invert" />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
          <MiniFact label="客户" value={data ? formatNumber(data.customerCount) : '—'} />
          <MiniFact label="已核销" value={data ? formatNumber(data.usedCodeCount) : '—'} />
          <MiniFact label="客单价" value={arpu > 0 ? formatYuanCompact(arpu) : '—'} />
        </div>
      </section>

      {tip ? (
        <div className="pt-card flex items-start gap-2.5 p-3.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-vip/20 text-vip-foreground">
            <Lightbulb className="size-3.5" />
          </span>
          <p className="text-[13px] leading-5">{tip}</p>
        </div>
      ) : null}

      <Segmented value={range} options={RANGES} onChange={setRange} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Users}
          label="激活客户"
          value={data ? formatNumber(data.customerCount) : '—'}
          hint="使用你的订阅码开通"
          loading={overview.isLoading}
          chart={<MiniBars values={stats?.trend.map((p) => p.newCustomers) ?? []} />}
        />
        <StatCard
          icon={TicketPercent}
          label={`近 ${days} 天激活`}
          value={stats ? formatNumber(stats.rangeActivations) : '—'}
          delta={activationDelta}
          loading={insights.isLoading}
          chart={<Sparkline values={activationSeries.length > 0 ? activationSeries : [0, 0]} />}
        />
        <StatCard
          icon={KeyRound}
          label="剩余可生成"
          value={data ? `${formatNumber(data.codeRemaining)} 张` : '—'}
          hint={data ? `已用 ${data.codesIssued}/${data.codeQuota}` : undefined}
          loading={overview.isLoading}
        />
        <StatCard
          icon={CalendarClock}
          label="剩余可发天数"
          value={data ? `${formatNumber(data.daysRemaining)} 天` : '—'}
          hint={data ? `已用 ${data.daysIssued}/${data.daysQuota}` : undefined}
          loading={overview.isLoading}
        />
      </div>

      <ChartCard
        title="收入 K 线"
        description={`按 ${Math.max(2, Math.ceil(days / 12))} 天一根，红涨绿跌，柱为激活量`}
      >
        {insights.isLoading ? (
          <Skeleton className="h-63 w-full" />
        ) : stats && stats.rangeRevenueCents > 0 ? (
          <CandleChart candles={stats.candles} />
        ) : (
          <p className="py-14 text-center text-xs text-muted-foreground">这段时间还没有卡密被核销</p>
        )}
      </ChartCard>

      <ChartCard title="增长趋势" description={`最近 ${days} 天的激活与新客户`}>
        {insights.isLoading ? (
          <Skeleton className="h-50 w-full" />
        ) : (
          <TrendAreaChart
            data={stats?.trend ?? []}
            series={[
              { key: 'activations', label: '激活' },
              { key: 'newCustomers', label: '新客户' },
            ]}
          />
        )}
      </ChartCard>

      <div className="grid gap-3">
        <ChartCard
          title="客户到期分布"
          description="到期越近越该主动触达"
          action={
            <Link to="/customers" className="pt-chip no-tap-highlight">
              去客户 <ChevronRight className="size-3" />
            </Link>
          }
        >
          <BarList
            items={stats?.expiryBuckets ?? []}
            highlight={['已到期', '7 天内']}
            empty="还没有客户"
            unit=" 人"
          />
        </ChartCard>

        <ChartCard title="订阅码状态" description={`核销率 ${formatPercent(conversion, 0)}`}>
          <BarList items={stats?.statusBreakdown ?? []} empty="还没有生成订阅码" unit=" 张" />
        </ChartCard>

        <ChartCard title="激活时间分布" description={`最近 ${days} 天按星期统计`}>
          {stats && stats.rangeActivations > 0 ? (
            <WeekdayRadar data={stats.weekday} />
          ) : (
            <p className="py-12 text-center text-xs text-muted-foreground">暂无激活记录</p>
          )}
        </ChartCard>
      </div>

      <ChartCard title="贡献榜" description="按累计消费排序的前 5 位客户">
        {stats && stats.topCustomers.length > 0 ? (
          <ul className="space-y-3">
            {stats.topCustomers.map((customer, index) => (
              <li key={customer.userId} className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-xs font-medium tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <InitialAvatar name={customer.displayName} src={customer.avatarUrl} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{customer.displayName}</p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <ExpiryBadge isExpired={customer.isExpired} daysRemaining={customer.daysRemaining} />
                    <span className="text-[11px] text-muted-foreground">{customer.codeCount} 张</span>
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                  {formatYuanCompact(customer.revenueCents)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">还没有客户核销订阅码</p>
        )}
      </ChartCard>

      <div className="grid grid-cols-2 gap-3">
        <QuickAction to="/codes" icon={KeyRound} title="生成订阅码" description="批量出码并导出" />
        <QuickAction to="/customers" icon={BadgeCheck} title="客户续期" description="给下级客户加时长" />
      </div>
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[15px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] text-white/50">{label}</p>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: typeof KeyRound;
  title: string;
  description: string;
}) {
  return (
    <Link to={to} className="pt-card no-tap-highlight vx-press flex items-center gap-3 p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
    </Link>
  );
}
