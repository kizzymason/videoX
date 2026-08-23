import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  cn,
} from '@videox/ui';
import { partnerApi } from '../lib/api';
import { formatFullDate, formatNumber } from '../lib/format';
import { ExpiryBadge } from '../components/ExpiryBadge';
import { BarList, ChartCard } from '../components/charts';
import { EmptyHint, InitialAvatar, ListSkeleton, PageHeader, Segmented } from '../components/primitives';

const FILTERS = [
  ['all', '全部'],
  ['active', '生效中'],
  ['expiring', '7 天内到期'],
  ['expired', '已到期'],
] as const;

const GRANT_PRESETS = [7, 30, 90, 365];

type Filter = (typeof FILTERS)[number][0];

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [input, setInput] = React.useState('');
  const [q, setQ] = React.useState('');
  const [expiry, setExpiry] = React.useState<Filter>('all');
  const [granting, setGranting] = React.useState<{ userId: string; username: string; displayName: string } | null>(null);
  const [days, setDays] = React.useState('30');

  // 300ms 防抖：手机上边打字边请求会把列表刷得一闪一闪。
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const list = useQuery({
    queryKey: ['partner-customers', q, expiry],
    queryFn: () => partnerApi.customers({ page: 1, pageSize: 50, q: q || undefined, expiry }),
    placeholderData: keepPreviousData,
  });
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });
  const insights = useQuery({ queryKey: ['partner-insights', 30], queryFn: () => partnerApi.insights(30) });

  const remainingDays = me.data?.daysRemaining ?? 0;
  const grantDays = Number(days);
  const grantInvalid = !Number.isFinite(grantDays) || grantDays < 1 || grantDays > remainingDays;

  const grant = useMutation({
    mutationFn: () => partnerApi.grant(granting!.userId, grantDays),
    onSuccess: async () => {
      toast.success(`已为 ${granting?.displayName} 增加 ${grantDays} 天`);
      setGranting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['partner-customers'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-insights'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-me'] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = list.data?.items ?? [];
  const total = list.data?.meta.total ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="客户" description={`使用你的订阅码开通的用户 · 共 ${formatNumber(total)} 位`} />

      <ChartCard title="到期分布" description="优先联系已到期与 7 天内到期的客户">
        {insights.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <BarList items={insights.data?.expiryBuckets ?? []} highlight={['已到期', '7 天内']} empty="还没有客户" unit=" 人" />
        )}
      </ChartCard>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索用户名或昵称"
          className="pl-9"
        />
      </div>

      <Segmented value={expiry} options={FILTERS} onChange={setExpiry} />

      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyHint
          icon={Users}
          title={q || expiry !== 'all' ? '没有符合条件的客户' : '还没有客户'}
          description={q || expiry !== 'all' ? '换个筛选条件试试' : '客户使用你的订阅码开通会员后会出现在这里'}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li key={row.userId} className="pt-card p-3.5">
              <div className="flex items-center gap-3">
                <InitialAvatar name={row.displayName} src={row.avatarUrl} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-medium">{row.displayName}</p>
                    <ExpiryBadge isExpired={row.isExpired} daysRemaining={row.daysRemaining} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    @{row.username} · {row.codeCount} 张码 · 到期 {formatFullDate(row.vipExpiresAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setDays(String(Math.min(30, Math.max(1, remainingDays))));
                    setGranting({ userId: row.userId, username: row.username, displayName: row.displayName });
                  }}
                >
                  <CalendarPlus />
                  续期
                </Button>
              </div>
              <ExpiryMeter isExpired={row.isExpired} daysRemaining={row.daysRemaining} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={granting !== null} onOpenChange={(open) => !open && setGranting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>为 {granting?.displayName} 增加时长</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              可发放天数剩余 <span className="font-medium tabular-nums text-foreground">{remainingDays}</span> 天，
              本次将扣除 <span className="font-medium tabular-nums text-foreground">{Number.isFinite(grantDays) ? grantDays : 0}</span> 天
            </div>
            <div className="flex flex-wrap gap-2">
              {GRANT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pt-chip no-tap-highlight"
                  data-active={Number(days) === preset}
                  disabled={preset > remainingDays}
                  onClick={() => setDays(String(preset))}
                >
                  {preset} 天
                </button>
              ))}
            </div>
            <Input
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
              aria-invalid={grantInvalid}
              placeholder="自定义天数"
            />
            {grantInvalid ? (
              <p className="text-xs text-destructive">
                {remainingDays === 0 ? '可发放天数已用完，请联系总站补充额度' : `请输入 1 ~ ${remainingDays} 之间的天数`}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGranting(null)}>
              取消
            </Button>
            <Button disabled={grant.isPending || grantInvalid} onClick={() => grant.mutate()}>
              确认续期
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 剩余时长条：以 90 天为满格，越短越红，扫一眼就能挑出该催的客户。 */
function ExpiryMeter({ isExpired, daysRemaining }: { isExpired: boolean; daysRemaining: number }) {
  const ratio = isExpired ? 0 : Math.min(1, daysRemaining / 90);
  const tone = isExpired ? 'bg-up' : daysRemaining <= 7 ? 'bg-vip' : 'bg-foreground/75';
  return (
    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${Math.max(ratio * 100, isExpired ? 100 : 4)}%` }} />
    </div>
  );
}
