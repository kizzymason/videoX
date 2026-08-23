import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Ban, Check, Copy, Download, KeyRound, Search, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminPartnerRow, RedeemCode } from '@videox/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useCopy,
  useDebouncedValue,
} from '@videox/ui';
import { downloadRedeemCodesCsv, membershipApi, partnersApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useAuthStore } from '../stores/auth';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { FilterSelect } from './VideosPage';
import { useConfirm } from '../components/ConfirmDialog';

const PAGE_SIZE = 20;
const OWNER_SELF = 'self';

export function RedeemCodesPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const { confirm, dialog } = useConfirm();
  const { copy, copied } = useCopy();

  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [planId, setPlanId] = React.useState('all');
  const [owner, setOwner] = React.useState('all');
  const [batchId, setBatchId] = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const [transferring, setTransferring] = React.useState<null | { ids?: string[]; batchIds?: string[]; label: string }>(null);
  const [batch, setBatch] = React.useState<{ batchId: string; codes: string[] } | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, status, planId, owner, batchId]);

  const { data: plans } = useQuery({ queryKey: ['admin-plans'], queryFn: membershipApi.plans, staleTime: 5 * 60_000 });
  const partners = useActivePartners();

  const createdBy = owner === 'all' ? undefined : owner === OWNER_SELF ? me?.id : owner;
  const query = {
    q: debouncedQ || undefined,
    status: status === 'all' ? undefined : status,
    planId: planId === 'all' ? undefined : planId,
    createdBy,
    batchId: batchId.trim() || undefined,
  };

  const list = useQuery({
    queryKey: ['redeem-codes', { page, ...query }],
    queryFn: () => membershipApi.codes({ page, pageSize: PAGE_SIZE, ...query }),
    placeholderData: keepPreviousData,
  });

  const disable = useMutation({
    mutationFn: (id: string) => membershipApi.disableCode(id),
    onSuccess: async () => {
      toast.success('卡密已作废');
      await queryClient.invalidateQueries({ queryKey: ['redeem-codes'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => membershipApi.bulkDeleteCodes(ids),
    onSuccess: async (res) => {
      toast.success(`已删除 ${res.deleted} 张卡密`);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ['redeem-codes'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runBulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `删除 ${ids.length} 张卡密？`,
      description: '已使用的卡密也会从记录中移除，不影响对应用户的会员状态。此操作不可撤销。',
      confirmText: '删除',
      destructive: true,
    });
    if (ok) bulkDelete.mutate(ids);
  };

  const selectedRows = (list.data?.items ?? []).filter((row) => selected.has(row.id));
  const selectedBatchIds = [...new Set(selectedRows.map((row) => row.batchId).filter((id): id is string => Boolean(id)))];

  const columns: Column<RedeemCode>[] = [
    {
      key: 'code',
      header: '卡密',
      cell: (row) => (
        <button
          type="button"
          onClick={() => {
            void copy(row.code);
            toast.success('已复制');
          }}
          className="group flex items-center gap-1.5 font-mono text-xs"
          title="点击复制"
        >
          {row.code}
          <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      ),
    },
    { key: 'plan', header: '套餐', cell: (row) => <span className="text-muted-foreground">{row.planName}</span> },
    {
      key: 'grantDays',
      header: '天数',
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.grantDays != null ? `${row.grantDays} 天` : '—'}</span>
      ),
    },
    {
      key: 'sale',
      header: '售价',
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.salePriceCents != null ? `¥${(row.salePriceCents / 100).toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 'creator',
      header: '归属',
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdByUsername ? `@${row.createdByUsername}` : '—'}</span>
      ),
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'usedBy',
      header: '使用者',
      cell: (row) =>
        row.usedByUsername ? (
          <span>
            @{row.usedByUsername}
            <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">{formatDateTime(row.usedAt)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'expiresAt',
      header: '有效期',
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">{row.expiresAt ? formatDateTime(row.expiresAt) : '不过期'}</span>
      ),
    },
    {
      key: 'batch',
      header: '批次',
      cell: (row) =>
        row.batchId ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
              title="按此批次筛选"
              onClick={() => setBatchId(row.batchId!)}
            >
              {row.batchId.slice(0, 8)}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title="整批划转"
              onClick={() =>
                setTransferring({
                  batchIds: [row.batchId!],
                  label: `批次 ${row.batchId!.slice(0, 8)} 的全部卡密`,
                })
              }
            >
              <ArrowRightLeft className="size-3" />
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'note',
      header: '备注',
      cell: (row) => <span className="block max-w-40 truncate text-muted-foreground">{row.note ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-14',
      cell: (row) =>
        row.status === 'unused' ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              title="作废"
              onClick={async () => {
                const ok = await confirm({
                  title: '作废该卡密？',
                  description: '作废后无法再兑换，也无法恢复。',
                  confirmText: '作废',
                  destructive: true,
                });
                if (ok) disable.mutate(row.id);
              }}
            >
              <Ban className="size-3.5 text-destructive" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="卡密管理"
        description="批量生成、指定归属、按批次划转与 CSV 导出"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await downloadRedeemCodesCsv(query);
                  toast.success('已开始下载');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Download />
              导出 CSV
            </Button>
            <Button size="sm" onClick={() => setGenerating(true)}>
              <Sparkles />
              生成卡密
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索卡密" className="h-8 pl-8 text-xs" />
        </div>
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'unused', label: '未使用' },
            { value: 'used', label: '已使用' },
            { value: 'expired', label: '已过期' },
            { value: 'disabled', label: '已作废' },
          ]}
        />
        <FilterSelect
          value={planId}
          onChange={setPlanId}
          options={[{ value: 'all', label: '全部套餐' }, ...(plans ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        />
        <FilterSelect
          value={owner}
          onChange={setOwner}
          className="h-8 w-44 text-xs"
          options={[
            { value: 'all', label: '全部归属' },
            { value: OWNER_SELF, label: '我（管理员）' },
            ...partners.map((p) => ({ value: p.userId, label: `@${p.username}` })),
          ]}
        />
        {batchId ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBatchId('')}
            title={batchId}
          >
            批次 {batchId.slice(0, 8)}
            <X />
          </Button>
        ) : null}
      </FilterBar>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span className="text-xs font-medium tabular-nums">已选 {selected.size} 项</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTransferring({ ids: [...selected], label: `已选的 ${selected.size} 张卡密` })}
          >
            <ArrowRightLeft />
            划转已选
          </Button>
          {selectedBatchIds.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setTransferring({
                  batchIds: selectedBatchIds,
                  label:
                    selectedBatchIds.length === 1
                      ? `批次 ${selectedBatchIds[0]!.slice(0, 8)} 的全部卡密`
                      : `所选 ${selectedBatchIds.length} 个批次的全部卡密`,
                })
              }
            >
              <ArrowRightLeft />
              整批划转
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" disabled={bulkDelete.isPending} onClick={() => void runBulkDelete()}>
            <Trash2 />
            删除
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X />
            取消选择
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        refreshing={list.isFetching && !list.isLoading}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        skeletonRows={PAGE_SIZE}
        emptyText="还没有卡密"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />

      <GenerateDialog
        open={generating}
        onClose={() => setGenerating(false)}
        partners={partners}
        onGenerated={async (result) => {
          setGenerating(false);
          setBatch(result);
          await queryClient.invalidateQueries({ queryKey: ['redeem-codes'] });
          await queryClient.invalidateQueries({ queryKey: ['admin-partners'] });
        }}
      />

      <TransferDialog
        open={transferring !== null}
        target={transferring}
        partners={partners}
        onClose={() => setTransferring(null)}
        onDone={async () => {
          setTransferring(null);
          setSelected(new Set());
          await queryClient.invalidateQueries({ queryKey: ['redeem-codes'] });
          await queryClient.invalidateQueries({ queryKey: ['admin-partners'] });
        }}
      />

      <Dialog open={batch !== null} onOpenChange={(open) => !open && setBatch(null)}>
        <DialogContent className="sm:max-w-125">
          <DialogHeader>
            <DialogTitle>已生成 {batch?.codes.length} 张卡密</DialogTitle>
            <DialogDescription>
              批次号 <span className="font-mono">{batch?.batchId}</span>，可复制全部或稍后在列表中按批次导出、划转。
            </DialogDescription>
          </DialogHeader>
          <Textarea readOnly rows={10} value={batch?.codes.join('\n') ?? ''} className="font-mono text-xs" />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void copy(batch?.codes.join('\n') ?? '');
                toast.success('已复制全部卡密');
              }}
            >
              {copied ? <Check /> : <Copy />}
              复制全部
            </Button>
            {batch?.batchId ? (
              <Button variant="outline" onClick={() => setTransferring({ batchIds: [batch.batchId], label: `批次 ${batch.batchId.slice(0, 8)} 的全部卡密` })}>
                <ArrowRightLeft />
                划转本批
              </Button>
            ) : null}
            <Button
              onClick={async () => {
                try {
                  await downloadRedeemCodesCsv({ batchId: batch?.batchId });
                  toast.success('已开始下载');
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Download />
              导出本批 CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </div>
  );
}

function useActivePartners(): AdminPartnerRow[] {
  const list = useQuery({
    queryKey: ['admin-partners', { page: 1, status: 'active', pageSize: 100 }],
    queryFn: () => partnersApi.list({ page: 1, pageSize: 100, status: 'active' }),
    staleTime: 30_000,
  });
  return list.data?.items ?? [];
}

function OwnerSelect({
  value,
  onChange,
  partners,
}: {
  value: string;
  onChange: (next: string) => void;
  partners: AdminPartnerRow[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="选择归属" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={OWNER_SELF}>自己（管理员）</SelectItem>
        {partners.map((partner) => (
          <SelectItem key={partner.userId} value={partner.userId}>
            @{partner.username} · 剩 {partner.codeRemaining} 张 / {partner.daysRemaining} 天
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GenerateDialog({
  open,
  onClose,
  onGenerated,
  partners,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: (result: { batchId: string; codes: string[] }) => void;
  partners: AdminPartnerRow[];
}) {
  const { data: plans } = useQuery({ queryKey: ['admin-plans'], queryFn: membershipApi.plans, staleTime: 5 * 60_000 });
  const [planId, setPlanId] = React.useState('');
  const [count, setCount] = React.useState('50');
  const [prefix, setPrefix] = React.useState('VIP');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [note, setNote] = React.useState('');
  const [ownerUserId, setOwnerUserId] = React.useState(OWNER_SELF);

  const activePlans = (plans ?? []).filter((p) => p.isActive);
  React.useEffect(() => {
    if (open && !planId && activePlans[0]) setPlanId(activePlans[0].id);
  }, [open, planId, activePlans]);

  const owner = partners.find((p) => p.userId === ownerUserId);
  const selectedPlan = activePlans.find((p) => p.id === planId);
  const countNum = Number(count);
  const daysNeeded = owner && selectedPlan ? countNum * selectedPlan.durationDays : 0;

  const generate = useMutation({
    mutationFn: () =>
      membershipApi.generateCodes({
        planId,
        count: countNum,
        prefix: prefix.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        note: note.trim() || undefined,
        ownerUserId,
      }),
    onSuccess: (result) => {
      toast.success(`成功生成 ${result.codes.length} 张卡密`);
      onGenerated(result);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validCount = countNum > 0 && countNum <= 5000;
  const quotaBlocked =
    owner != null && (countNum > owner.codeRemaining || daysNeeded > owner.daysRemaining);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-110">
        <DialogHeader>
          <DialogTitle>批量生成卡密</DialogTitle>
          <DialogDescription>可记到自己名下，或直接发给某个合伙人（占用其张数与天数配额）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <Field label="归属" hint={owner ? `该合伙人还可生成 ${owner.codeRemaining} 张 / ${owner.daysRemaining} 天` : '记在当前管理员名下，不占合伙人配额'}>
            <OwnerSelect value={ownerUserId} onChange={setOwnerUserId} partners={partners} />
          </Field>
          <Field label="绑定套餐" hint="决定兑换后增加的会员天数">
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="选择套餐" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name} · {plan.durationDays} 天
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="生成数量" hint="单批上限 5000">
              <Input type="number" min={1} max={5000} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="卡密前缀" hint="大写字母和数字，一般为 3 位；整码共 12 位，中间不加 -">
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={8}
                placeholder="VIP"
              />
            </Field>
          </div>
          <Field label="卡密有效期" hint="留空表示永不过期；这是卡密本身的可兑换期限">
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
          <Field label="备注">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：双十一渠道 A" />
          </Field>
          {quotaBlocked ? (
            <p className="text-xs text-destructive">
              超出 @{owner?.username} 的剩余配额
              {selectedPlan ? `（本次 ${countNum} 张 / ${daysNeeded} 天）` : ''}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!planId || !validCount || quotaBlocked || generate.isPending} onClick={() => generate.mutate()}>
            <KeyRound />
            {generate.isPending ? '生成中…' : '生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  open,
  target,
  partners,
  onClose,
  onDone,
}: {
  open: boolean;
  target: { ids?: string[]; batchIds?: string[]; label: string } | null;
  partners: AdminPartnerRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [ownerUserId, setOwnerUserId] = React.useState(OWNER_SELF);
  React.useEffect(() => {
    if (open) setOwnerUserId(OWNER_SELF);
  }, [open]);

  const owner = partners.find((p) => p.userId === ownerUserId);
  const transfer = useMutation({
    mutationFn: () =>
      membershipApi.transferCodes({
        ownerUserId,
        ids: target?.ids,
        batchIds: target?.batchIds,
      }),
    onSuccess: (res) => {
      toast.success(`已划转 ${res.transferred} 张（未使用 ${res.unused} / 已核销 ${res.used}）`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-110">
        <DialogHeader>
          <DialogTitle>划转卡密</DialogTitle>
          <DialogDescription>
            将{target?.label ?? '所选卡密'}转到目标名下。未使用的会占用目标合伙人配额；已核销的只改客户归属。
          </DialogDescription>
        </DialogHeader>
        <Field label="转到" hint={owner ? `还可接收 ${owner.codeRemaining} 张 / ${owner.daysRemaining} 天` : '转给当前管理员，退回原合伙人未使用配额'}>
          <OwnerSelect value={ownerUserId} onChange={setOwnerUserId} partners={partners} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={transfer.isPending} onClick={() => transfer.mutate()}>
            <ArrowRightLeft />
            {transfer.isPending ? '划转中…' : '确认划转'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
