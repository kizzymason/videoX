import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Crown,
  Eye,
  Film,
  HardDrive,
  MessageSquare,
  RefreshCw,
  Users,
  Wallet,
  type LucideProps,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Skeleton, cn } from '@videox/ui';
import { dashboardApi, type TopVideoRow } from '../lib/api';
import { formatBytes, formatCents, formatDelta, formatNumber, formatPercent, formatWatchTime } from '../lib/format';
import { PageHeader } from '../components/Page';
import { ChartCard, RetentionChart, TrendAreaChart } from '../components/charts';

const RANGES = [7, 30, 90] as const;

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [days, setDays] = React.useState<number>(30);
  const [retentionId, setRetentionId] = React.useState<string | null>(null);

  // 实时区块自己走短轮询，其余卡片保持默认 staleTime，避免整页高频刷新。
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: dashboardApi.overview,
    refetchInterval: 20_000,
  });
  const insights = useQuery({ queryKey: ['insights', days], queryFn: () => dashboardApi.insights(days) });
  const topVideos = useQuery({ queryKey: ['top-videos', days], queryFn: () => dashboardApi.topVideos(days) });

  const activeVideoId = retentionId ?? topVideos.data?.[0]?.id ?? null;
  const retention = useQuery({
    queryKey: ['retention', activeVideoId],
    queryFn: () => dashboardApi.retention(activeVideoId!),
    enabled: Boolean(activeVideoId),
  });

  const aggregate = useMutation({
    mutationFn: dashboardApi.aggregate,
    onSuccess: async () => {
      toast.success('已重新聚合最近 7 天数据');
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = overview.data?.totals;
  const deltas = overview.data?.deltas;
  const realtime = overview.data?.realtime;

  return (
    <div className="space-y-5">
      <PageHeader
        title="仪表盘"
        description="核心经营指标、趋势与实时在线"
        actions={
          <>
            <RangeSwitch value={days} onChange={setDays} />
            <Button
              variant="outline"
              size="sm"
              disabled={aggregate.isPending}
              onClick={() => aggregate.mutate()}
            >
              <RefreshCw className={cn(aggregate.isPending && 'animate-spin')} />
              重新聚合
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Eye}
          label="总播放量"
          value={totals ? formatNumber(totals.views) : undefined}
          delta={totals && deltas ? formatDelta(totals.views, deltas.views) : null}
          hint={`近 ${days} 天`}
        />
        <MetricCard
          icon={Users}
          label="注册用户"
          value={totals ? formatNumber(totals.users) : undefined}
          delta={totals && deltas ? formatDelta(totals.users, deltas.users) : null}
          hint={totals ? `其中会员 ${formatNumber(totals.vipUsers)}` : undefined}
        />
        <MetricCard
          icon={Wallet}
          label="累计收入"
          value={totals ? formatCents(totals.revenueCents) : undefined}
          delta={totals && deltas ? formatDelta(totals.revenueCents, deltas.revenueCents) : null}
        />
        <MetricCard
          icon={Clock}
          label="累计观看时长"
          value={totals ? formatWatchTime(totals.watchSeconds) : undefined}
          delta={totals && deltas ? formatDelta(totals.watchSeconds, deltas.watchSeconds) : null}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat icon={Film} label="视频总数" value={totals ? formatNumber(totals.videos) : undefined} />
        <MiniStat icon={MessageSquare} label="评论总数" value={totals ? formatNumber(totals.comments) : undefined} />
        <MiniStat icon={Crown} label="会员用户" value={totals ? formatNumber(totals.vipUsers) : undefined} />
        <MiniStat icon={HardDrive} label="存储占用" value={totals ? formatBytes(totals.storageBytes) : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        <ChartCard title="经营趋势" description={`最近 ${days} 天的播放、访客与收入`}>
          {insights.isLoading ? (
            <Skeleton className="h-65 w-full" />
          ) : (
            <TrendAreaChart
              data={insights.data?.trend ?? []}
              series={[
                { key: 'videoViews', label: '播放量' },
                { key: 'uniqueVisitors', label: '独立访客' },
                {
                  key: 'revenueCents',
                  label: '收入',
                  transform: (v) => v / 100,
                  format: (v) => `¥${v.toFixed(2)}`,
                },
              ]}
            />
          )}
        </ChartCard>

        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <h3 className="text-sm font-semibold">实时在线</h3>
            </div>
            <div className="space-y-3">
              <RealtimeRow label="在线用户" value={realtime?.onlineUsers} />
              <RealtimeRow label="正在播放" value={realtime?.playingNow} />
              <RealtimeRow label="近 30 分钟播放" value={realtime?.last30MinViews} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">访客质量</h3>
            <div className="space-y-3">
              <RealtimeRow
                label="平均停留"
                text={insights.data ? formatWatchTime(insights.data.avgSessionSeconds) : undefined}
              />
              <RealtimeRow
                label="跳出率"
                text={insights.data ? formatPercent(insights.data.bounceRate) : undefined}
              />
              <RealtimeRow
                label="新访客占比"
                text={
                  insights.data
                    ? formatPercent(
                        insights.data.newVsReturning.newVisitors /
                          Math.max(1, insights.data.newVsReturning.newVisitors + insights.data.newVsReturning.returning),
                      )
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="热门视频" description={`最近 ${days} 天播放排行，点击查看留存曲线`}>
          {topVideos.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (topVideos.data ?? []).length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">该时间段还没有播放数据</p>
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {topVideos.data!.map((video, index) => (
                <TopVideoItem
                  key={video.id}
                  video={video}
                  rank={index + 1}
                  active={video.id === activeVideoId}
                  onSelect={() => setRetentionId(video.id)}
                />
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard
          title="观看留存"
          description={
            activeVideoId
              ? topVideos.data?.find((v) => v.id === activeVideoId)?.title ?? '所选视频'
              : '选择一个视频查看逐段留存'
          }
        >
          {!activeVideoId ? (
            <p className="py-16 text-center text-xs text-muted-foreground">左侧点选视频后展示</p>
          ) : retention.isLoading ? (
            <Skeleton className="h-50 w-full" />
          ) : (retention.data ?? []).length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">样本不足，暂无留存数据</p>
          ) : (
            <RetentionChart data={retention.data!} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

export function RangeSwitch({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-border p-0.5">
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs transition-colors',
            value === range ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {range} 天
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
  value: string | undefined;
  delta?: { text: string; up: boolean } | null;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} />
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        {value === undefined ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</span>
        )}
        {delta ? (
          <span
            className={cn(
              'flex items-center gap-0.5 pb-0.5 text-xs tabular-nums',
              delta.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
            )}
          >
            {delta.up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {delta.text}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
  value: string | undefined;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {value === undefined ? (
          <Skeleton className="mt-1 h-4 w-16" />
        ) : (
          <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
        )}
      </div>
    </div>
  );
}

function RealtimeRow({ label, value, text }: { label: string; value?: number; text?: string }) {
  const display = text ?? (value === undefined ? undefined : formatNumber(value));
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {display === undefined ? (
        <Skeleton className="h-5 w-12" />
      ) : (
        <span className="text-base font-semibold tabular-nums">{display}</span>
      )}
    </div>
  );
}

function TopVideoItem({
  video,
  rank,
  active,
  onSelect,
}: {
  video: TopVideoRow;
  rank: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
          active ? 'bg-accent' : 'hover:bg-accent/60',
        )}
      >
        <span className="w-4 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums">{rank}</span>
        {video.posterUrl ? (
          <img src={video.posterUrl} alt="" className="h-9 w-16 shrink-0 rounded object-cover" loading="lazy" />
        ) : (
          <span className="h-9 w-16 shrink-0 rounded bg-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{video.title}</span>
          <span className="block text-[11px] text-muted-foreground tabular-nums">
            {formatNumber(video.plays)} 播放 · {formatWatchTime(video.watchSeconds)} · 完播{' '}
            {formatPercent(video.completionRate, 0)}
          </span>
        </span>
        <Activity className={cn('size-3.5 shrink-0', active ? 'text-foreground' : 'text-muted-foreground/40')} />
      </button>
    </li>
  );
}
