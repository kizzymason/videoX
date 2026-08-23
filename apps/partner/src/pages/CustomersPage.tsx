import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input } from '@videox/ui';
import { partnerApi } from '../lib/api';
import { formatDate } from '../lib/format';
import { ExpiryBadge } from '../components/ExpiryBadge';

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState('');
  const [expiry, setExpiry] = React.useState<'all' | 'active' | 'expiring' | 'expired'>('all');
  const [granting, setGranting] = React.useState<{ userId: string; username: string } | null>(null);
  const [days, setDays] = React.useState('7');

  const list = useQuery({
    queryKey: ['partner-customers', q, expiry],
    queryFn: () => partnerApi.customers({ page: 1, pageSize: 50, q: q.trim() || undefined, expiry }),
    placeholderData: keepPreviousData,
  });
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });

  const grant = useMutation({
    mutationFn: () => partnerApi.grant(granting!.userId, Number(days)),
    onSuccess: async () => {
      toast.success('已增加会员时长');
      setGranting(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['partner-customers'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-me'] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">客户</h1>
        <p className="mt-1 text-sm text-muted-foreground">使用你的订阅码开通的用户</p>
      </header>

      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索用户名" />
      <div className="flex gap-2 overflow-auto">
        {(
          [
            ['all', '全部'],
            ['active', '生效'],
            ['expiring', '将到期'],
            ['expired', '已到期'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setExpiry(value)}
            className={`rounded-full px-3 py-1 text-xs ${expiry === value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {(list.data?.items ?? []).map((row) => (
          <div key={row.userId} className="stat-card flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.displayName}</p>
              <p className="text-xs text-muted-foreground">
                @{row.username} · {row.codeCount} 张码 · {formatDate(row.vipExpiresAt)}
              </p>
              <div className="mt-1.5">
                <ExpiryBadge vipExpiresAt={row.vipExpiresAt} isExpired={row.isExpired} daysRemaining={row.daysRemaining} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setGranting({ userId: row.userId, username: row.username })}>
              加时长
            </Button>
          </div>
        ))}
        {(list.data?.items ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">还没有客户</p>
        ) : null}
      </div>

      <Dialog open={granting !== null} onOpenChange={(v) => !v && setGranting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>为 @{granting?.username} 加时长</DialogTitle>
          </DialogHeader>
          <Field label={`天数（剩余 ${me.data?.daysRemaining ?? 0} 天）`}>
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGranting(null)}>
              取消
            </Button>
            <Button disabled={grant.isPending || Number(days) < 1} onClick={() => grant.mutate()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
