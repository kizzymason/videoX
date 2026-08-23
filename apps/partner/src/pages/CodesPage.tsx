import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  CheckCheck,
  Copy,
  Download,
  KeyRound,
  Minus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RedeemCode } from '@videox/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  Textarea,
  cn,
  useCopy,
} from '@videox/ui';
import { downloadPartnerCodesCsv, partnerApi } from '../lib/api';
import { formatDateTime, formatNumber, formatYuan } from '../lib/format';
import { BarList, ChartCard } from '../components/charts';
import { EmptyHint, ListSkeleton, PageHeader, Segmented } from '../components/primitives';

const STATUS_LABEL: Record<string, string> = {
  unused: '未使用',
  used: '已使用',
  disabled: '已停用',
  expired: '已过期',
};

const STATUS_STYLE: Record<string, string> = {
  unused: 'bg-primary text-primary-foreground',
  used: 'bg-down/12 text-down',
  disabled: 'bg-muted text-muted-foreground',
  expired: 'bg-up/10 text-up',
};

const FILTERS = [
  ['all', '全部'],
  ['unused', '未使用'],
  ['used', '已使用'],
  ['disabled', '已停用'],
] as const;

const DAY_PRESETS = [30, 90, 180, 365];

type Filter = (typeof FILTERS)[number][0];

export function CodesPage() {
  const queryClient = useQueryClient();
  const { copy } = useCopy();
  const [status, setStatus] = React.useState<Filter>('all');
  const [input, setInput] = React.useState('');
  const [q, setQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [batch, setBatch] = React.useState<string[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const [days, setDays] = React.useState('30');
  const [count, setCount] = React.useState('1');
  const [price, setPrice] = React.useState('19');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const list = useQuery({
    queryKey: ['partner-codes', status, q],
    queryFn: () =>
      partnerApi.codes({ page: 1, pageSize: 100, status: status === 'all' ? undefined : status, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });
  const insights = useQuery({ queryKey: ['partner-insights', 30], queryFn: () => partnerApi.insights(30) });

  const codeRemaining = me.data?.codeRemaining ?? 0;
  const daysRemaining = me.data?.daysRemaining ?? 0;

  const daysNum = Number(days) || 0;
  const countNum = Number(count) || 0;
  const priceNum = Number(price) || 0;
  const needDays = daysNum * countNum;
  const overCount = countNum > codeRemaining;
  const overDays = needDays > daysRemaining;
  const formInvalid = daysNum < 1 || countNum < 1 || priceNum < 0 || overCount || overDays;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-codes'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-insights'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-me'] }),
    ]);
  };

  const generate = useMutation({
    mutationFn: () =>
      partnerApi.generate({
        days: daysNum,
        count: countNum,
        salePriceYuan: priceNum,
        note: note.trim() || undefined,
      }),
    onSuccess: async (res) => {
      toast.success(`已生成 ${res.codes.length} 张订阅码`);
      setCreating(false);
      setNote('');
      setBatch(res.codes);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disable = useMutation({
    mutationFn: (id: string) => partnerApi.disable(id),
    onSuccess: async () => {
      toast.success('订阅码已停用');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => partnerApi.bulkDelete(ids),
    onSuccess: async (res) => {
      toast.success(`已删除 ${res.deleted} 张未使用订阅码，额度已退回`);
      setSelected(new Set());
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = list.data?.items ?? [];
  const selectableIds = items.filter((row) => row.status === 'unused').map((row) => row.id);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyCode = async (row: RedeemCode) => {
    await copy(row.code);
    setCopiedId(row.id);
    toast.success('订阅码已复制');
    setTimeout(() => setCopiedId((current) => (current === row.id ? null : current)), 1600);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="订阅"
        description="生成、导出并管理你的订阅码"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={codeRemaining === 0}>
            <Plus />
            生成
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <QuotaBar label="可生成张数" used={me.data?.codesIssued ?? 0} total={me.data?.codeQuota ?? 0} remain={codeRemaining} unit="张" />
        <QuotaBar label="可发放天数" used={me.data?.daysIssued ?? 0} total={me.data?.daysQuota ?? 0} remain={daysRemaining} unit="天" />
      </div>

      <ChartCard
        title="库存概览"
        description="未使用的卡密就是还没变现的库存"
        action={
          <button
            type="button"
            className="pt-chip no-tap-highlight"
            onClick={async () => {
              try {
                await downloadPartnerCodesCsv(status === 'all' ? {} : { status });
                toast.success('已开始下载 CSV');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <Download className="size-3" />
            导出
          </button>
        }
      >
        {insights.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <BarList items={insights.data?.statusBreakdown ?? []} empty="还没有生成订阅码" unit=" 张" />
        )}
      </ChartCard>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索订阅码" className="pl-9 pt-code" />
      </div>

      <Segmented value={status} options={FILTERS} onChange={setStatus} />

      {selected.size > 0 ? (
        <div className="pt-card sticky top-[86px] z-10 flex items-center justify-between gap-2 p-2.5">
          <span className="pl-1 text-xs text-muted-foreground">已选 {selected.size} 张未使用</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X />
              取消
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set(selectableIds))}
              disabled={selected.size === selectableIds.length}
            >
              <CheckCheck />
              全选
            </Button>
            <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate([...selected])}>
              <Trash2 />
              删除
            </Button>
          </div>
        </div>
      ) : null}

      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyHint
          icon={KeyRound}
          title={q || status !== 'all' ? '没有符合条件的订阅码' : '还没有订阅码'}
          description={q || status !== 'all' ? '换个筛选条件试试' : '点右上角「生成」创建第一批'}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((row) => {
            const picked = selected.has(row.id);
            return (
              <li key={row.id} className={cn('pt-card p-3.5 transition-shadow', picked && 'ring-2 ring-primary')}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="no-tap-highlight vx-press min-w-0 text-left"
                    onClick={() => void copyCode(row)}
                  >
                    <span className="pt-code block break-all font-medium">{row.code}</span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      {copiedId === row.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copiedId === row.id ? '已复制' : '点按复制'}
                    </span>
                  </button>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATUS_STYLE[row.status] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-center">
                  <Meta label="时长" value={row.grantDays != null ? `${row.grantDays} 天` : '—'} />
                  <Meta label="售价" value={row.salePriceCents != null ? formatYuan(row.salePriceCents) : '未定价'} />
                  <Meta label={row.status === 'used' ? '核销' : '创建'} value={formatDateTime(row.status === 'used' ? row.usedAt : row.createdAt)} />
                </dl>

                {row.usedByUsername ? (
                  <p className="mt-2 truncate text-[11px] text-muted-foreground">已由 @{row.usedByUsername} 使用</p>
                ) : null}
                {row.note ? <p className="mt-1 truncate text-[11px] text-muted-foreground">备注：{row.note}</p> : null}

                {row.status === 'unused' ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => disable.mutate(row.id)}>
                      <Ban />
                      停用
                    </Button>
                    <Button size="sm" variant={picked ? 'default' : 'ghost'} className="flex-1" onClick={() => toggle(row.id)}>
                      {picked ? <Check /> : <Trash2 />}
                      {picked ? '已选中' : '选择'}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成订阅码</DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">每张时长</p>
              <div className="flex flex-wrap gap-2">
                {DAY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="pt-chip no-tap-highlight"
                    data-active={Number(days) === preset}
                    onClick={() => setDays(String(preset))}
                  >
                    {preset} 天
                  </button>
                ))}
                <Input
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
                  className="h-8 w-20 text-center"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">生成张数</p>
              <Stepper
                value={countNum}
                max={codeRemaining}
                onChange={(next) => setCount(String(next))}
              />
            </div>

            <Field label="每张售价（元）">
              <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
            </Field>

            <Field label="备注">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选，例如渠道名" />
            </Field>

            <div className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-xs">
              <SummaryRow label="扣除张数" value={`${countNum} / 剩 ${codeRemaining}`} warn={overCount} />
              <SummaryRow label="扣除天数" value={`${needDays} / 剩 ${daysRemaining}`} warn={overDays} />
              <SummaryRow label="预计收入" value={formatYuan(Math.round(priceNum * 100) * countNum)} />
            </div>
            {overCount ? <p className="text-xs text-destructive">超出可生成张数，请联系总站补充额度</p> : null}
            {overDays ? <p className="text-xs text-destructive">超出可发放天数，减少张数或缩短时长</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button disabled={generate.isPending || formInvalid} onClick={() => generate.mutate()}>
              生成 {countNum > 0 ? `${countNum} 张` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batch !== null} onOpenChange={(open) => !open && setBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>已生成 {batch?.length ?? 0} 张订阅码</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">建议先复制或导出保存，离开页面后可在列表中按状态筛选找回。</p>
          <Textarea readOnly rows={7} value={batch?.join('\n') ?? ''} className="pt-code" />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void copy(batch?.join('\n') ?? '');
                toast.success('已复制全部订阅码');
              }}
            >
              <Copy />
              复制全部
            </Button>
            <Button
              onClick={async () => {
                try {
                  await downloadPartnerCodesCsv({ status: 'unused' });
                  toast.success('已开始下载 CSV');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Download />
              导出 CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-[12px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', warn ? 'font-medium text-destructive' : 'font-medium')}>{value}</span>
    </div>
  );
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (next: number) => void }) {
  const clamp = (next: number) => Math.max(1, Math.min(Math.max(1, max), next));
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="outline" className="size-8" onClick={() => onChange(clamp(value - 1))} disabled={value <= 1}>
        <Minus />
      </Button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, '')) || 1))}
        className="h-8 w-14 rounded-md border border-input bg-transparent text-center text-sm tabular-nums"
      />
      <Button size="icon" variant="outline" className="size-8" onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>
        <Plus />
      </Button>
    </div>
  );
}

function QuotaBar({
  label,
  used,
  total,
  remain,
  unit,
}: {
  label: string;
  used: number;
  total: number;
  remain: number;
  unit: string;
}) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className="pt-card p-3.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-tight tabular-nums">
        {formatNumber(remain)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}可用</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/80 transition-[width] duration-500" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
        已用 {formatNumber(used)} / {formatNumber(total)} {unit}
      </p>
    </div>
  );
}
