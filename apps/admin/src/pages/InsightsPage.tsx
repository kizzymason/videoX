import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@videox/ui';
import { dashboardApi } from '../lib/api';
import { formatNumber, formatPercent, formatWatchTime } from '../lib/format';
import { PageHeader } from '../components/Page';
import { RangeSwitch } from './DashboardPage';
import { BreakdownBars, ChartCard, DonutChart, TrendAreaChart } from '../components/charts';

export function InsightsPage() {
  const [days, setDays] = React.useState(30);
  const { data, isLoading } = useQuery({ queryKey: ['insights', days], queryFn: () => dashboardApi.insights(days) });

  const newVisitors = data?.newVsReturning.newVisitors ?? 0;
  const returning = data?.newVsReturning.returning ?? 0;
  const totalVisitors = newVisitors + returning;

  return (
    <div className="space-y-5">
      <PageHeader
        title="访客洞察"
        description="来源、设备、地域与行为路径的综合分析"
        actions={<RangeSwitch value={days} onChange={setDays} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="独立访客" value={data ? formatNumber(totalVisitors) : undefined} />
        <SummaryCard
          label="新访客占比"
          value={data ? formatPercent(newVisitors / Math.max(1, totalVisitors)) : undefined}
          hint={data ? `新 ${formatNumber(newVisitors)} · 回访 ${formatNumber(returning)}` : undefined}
        />
        <SummaryCard label="平均停留" value={data ? formatWatchTime(data.avgSessionSeconds) : undefined} />
        <SummaryCard label="跳出率" value={data ? formatPercent(data.bounceRate) : undefined} />
      </div>

      <ChartCard title="访问趋势" description={`最近 ${days} 天的浏览量、独立访客与新注册`}>
        {isLoading ? (
          <Skeleton className="h-65 w-full" />
        ) : (
          <TrendAreaChart
            data={data?.trend ?? []}
            series={[
              { key: 'pageviews', label: '浏览量' },
              { key: 'uniqueVisitors', label: '独立访客' },
              { key: 'newUsers', label: '新注册' },
            ]}
          />
        )}
      </ChartCard>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard title="设备类型">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <DonutChart items={data?.devices ?? []} />}
          {!isLoading && (data?.devices.length ?? 0) > 0 ? (
            <ul className="mt-2 space-y-1">
              {data!.devices.slice(0, 5).map((item) => (
                <li key={item.label} className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">{item.label || '未知'}</span>
                  <span className="tabular-nums">{(item.percent * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          ) : null}
        </ChartCard>

        <ChartCard title="浏览器">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.browsers ?? []} />}
        </ChartCard>

        <ChartCard title="操作系统">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.os ?? []} />}
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="来源渠道" description="referrer 归一化后的站外来源">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.referrers ?? []} empty="全部为直接访问" />}
        </ChartCard>
        <ChartCard title="UTM 来源" description="投放链接携带的 utm_source">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.utmSources ?? []} empty="暂无投放数据" />}
        </ChartCard>
        <ChartCard title="地域分布">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.countries ?? []} empty="未开启地域解析" />}
        </ChartCard>
        <ChartCard title="热门页面">
          {isLoading ? <Skeleton className="h-45 w-full" /> : <BreakdownBars items={data?.topPaths ?? []} />}
        </ChartCard>
      </div>

      <ChartCard title="热门搜索词" description="站内搜索行为，可作为内容选题参考">
        {isLoading ? (
          <Skeleton className="h-30 w-full" />
        ) : (data?.topKeywords.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">该时间段没有搜索行为</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data!.topKeywords.map((item) => (
              <span
                key={item.label}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
              >
                {item.label}
                <span className="text-muted-foreground tabular-nums">{formatNumber(item.value)}</span>
              </span>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="mt-2 text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
