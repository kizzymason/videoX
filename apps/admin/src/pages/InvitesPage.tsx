import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Search, ShieldAlert, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  useDebouncedValue,
} from '@videox/ui';
import { invitesAdminApi, type InviteRecordRow } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { FilterBar, PageHeader, SectionTitle } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';

const PAGE_SIZE = 20;

const REASON_LABELS: Record<string, string> = {
  disabled: '活动已关闭',
  device_reused: '同一设备已领过',
  ip_reused: '同一 IP 已领过',
  same_device: '与邀请人同一设备',
  same_ip: '与邀请人同一 IP',
  grant_failed: '发放失败',
};

export function InvitesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const debouncedQ = useDebouncedValue(q.trim(), 300);

  React.useEffect(() => setPage(1), [debouncedQ, status]);

  const overview = useQuery({ queryKey: ['admin-invites-overview'], queryFn: invitesAdminApi.overview });
  const records = useQuery({
    queryKey: ['admin-invites-records', { page, debouncedQ, status }],
    queryFn: () =>
      invitesAdminApi.records({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  const [enabled, setEnabled] = React.useState(true);
  const [rewardDays, setRewardDays] = React.useState('1');

  React.useEffect(() => {
    if (overview.data?.settings) {
      setEnabled(overview.data.settings.enabled);
      setRewardDays(String(overview.data.settings.rewardDays));
    }
  }, [overview.data?.settings]);

  const save = useMutation({
    mutationFn: () => invitesAdminApi.updateSettings({ enabled, rewardDays: Number(rewardDays) || 0 }),
    onSuccess: async () => {
      toast.success('邀请设置已保存');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-invites-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-invites-records'] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<InviteRecordRow>[] = [
    {
      key: 'inviter',
      header: '邀请人',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{r.inviter.displayName || r.inviter.username}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">@{r.inviter.username}</p>
        </div>
      ),
    },
    {
      key: 'invitee',
      header: '被邀请人',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{r.invitee.displayName || r.invitee.username}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">@{r.invitee.username}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (r) =>
        r.status === 'granted' ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
            已发放 {r.days} 天
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
            已拦截 · {REASON_LABELS[r.reason] ?? r.reason}
          </span>
        ),
    },
    {
      key: 'network',
      header: '网络 / 设备',
      cell: (r) => (
        <div className="text-[11px] text-muted-foreground">
          <p className="font-mono">{r.inviteeIp || '—'}</p>
          <p className="font-mono opacity-70">{r.deviceHash || '—'}</p>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: '时间',
      cell: (r) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="邀请管理" description="设置邀请奖励天数，查看邀请人数与被防刷拦下的记录" />

      <div className="mb-5 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardContent className="space-y-3 p-5">
            <SectionTitle>邀请奖励</SectionTitle>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">开启邀请功能</p>
                <p className="text-xs text-muted-foreground">关闭后邀请码仍可生成，但注册时不再发放奖励。</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">每位好友赠送</span>
                <Input
                  value={rewardDays}
                  onChange={(e) => setRewardDays(e.target.value.replace(/[^\d]/g, ''))}
                  className="h-9 w-20 text-center tabular-nums"
                  inputMode="numeric"
                />
                <span className="text-sm">天</span>
              </div>
              <span className="text-xs text-muted-foreground">邀请人与被邀请人各得一次，填写 0 表示只记录不发放。</span>
              <Button className="ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? '保存中…' : '保存设置'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={<UserPlus className="size-4" />} label="累计邀请" value={overview.data ? formatNumber(overview.data.totalInvited) : '—'} />
          <StatCard icon={<Gift className="size-4" />} label="累计发放天数" value={overview.data ? formatNumber(overview.data.totalDays) : '—'} />
          <StatCard icon={<UserPlus className="size-4" />} label="今日邀请" value={overview.data ? formatNumber(overview.data.todayInvited) : '—'} />
          <StatCard
            icon={<ShieldAlert className="size-4" />}
            label="防刷拦截"
            value={overview.data ? formatNumber(overview.data.rejected) : '—'}
            hint={overview.data ? `${formatNumber(overview.data.inviters)} 位邀请人` : undefined}
          />
        </div>
      </div>

      {overview.data && overview.data.top.length > 0 ? (
        <Card className="mb-5">
          <CardContent className="p-5">
            <SectionTitle>邀请榜</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {overview.data.top.map((row, index) => (
                <div key={row.userId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.displayName || row.username}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">@{row.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{row.invited} 人</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{row.days} 天</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <SectionTitle>邀请记录</SectionTitle>
          <FilterBar>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索邀请人或被邀请人"
                className="h-9 w-64 pl-8"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="granted">已发放</SelectItem>
                <SelectItem value="rejected">已拦截</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>

          {records.isLoading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={records.data?.items ?? []}
                rowKey={(r) => r.id}
                refreshing={records.isFetching && !records.isLoading}
                emptyText="还没有邀请记录"
                skeletonRows={PAGE_SIZE}
              />
              <Pagination meta={records.data?.meta} onChange={setPage} busy={records.isFetching} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
