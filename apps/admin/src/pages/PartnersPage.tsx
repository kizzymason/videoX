import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Pencil, Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { partnerLevelLabel, type AdminPartnerRow } from '@videox/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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
  useDebouncedValue,
} from '@videox/ui';
import { partnersApi, usersApi, type AdminUserRow } from '../lib/api';
import { formatCents, formatDateTime, formatNumber } from '../lib/format';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { FilterSelect } from './VideosPage';
import { useConfirm } from '../components/ConfirmDialog';

const PAGE_SIZE = 20;

export function PartnersPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('active');
  const [appointing, setAppointing] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminPartnerRow | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, status]);

  const list = useQuery({
    queryKey: ['admin-partners', { page, debouncedQ, status }],
    queryFn: () =>
      partnersApi.list({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-partners'] });

  const revoke = useMutation({
    mutationFn: (id: string) => partnersApi.revoke(id),
    onSuccess: async () => {
      toast.success('已取消合伙人');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<AdminPartnerRow>[] = [
    {
      key: 'user',
      header: '合伙人',
      cell: (row) => (
        <button type="button" className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => setDetailId(row.userId)}>
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={row.avatarUrl ?? undefined} alt={row.displayName} />
            <AvatarFallback>{row.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">@{row.username}</p>
          </div>
        </button>
      ),
    },
    { key: 'level', header: '等级', cell: (row) => partnerLevelLabel(row.level) },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status === 'active' ? 'active' : 'canceled'} /> },
    {
      key: 'customers',
      header: '客户',
      cell: (row) => <span className="tabular-nums">{formatNumber(row.customerCount)}</span>,
    },
    {
      key: 'codes',
      header: '卡密配额',
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.codesIssued}/{row.codeQuota}
          <span className="ml-1 text-[11px]">剩 {row.codeRemaining}</span>
        </span>
      ),
    },
    {
      key: 'days',
      header: '天数配额',
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.daysIssued}/{row.daysQuota}
          <span className="ml-1 text-[11px]">剩 {row.daysRemaining}</span>
        </span>
      ),
    },
    {
      key: 'revenue',
      header: '收入',
      cell: (row) => <span className="tabular-nums">{formatCents(row.revenueCents)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-40',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" title="调整配额" onClick={() => setEditing(row)}>
            <Pencil className="size-3.5" />
          </Button>
          {row.status === 'active' ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: '取消合伙人？',
                  description: `${row.displayName} 将无法登录合伙人后台，已发卡密与客户关系会保留。`,
                  confirmText: '取消合伙人',
                  destructive: true,
                });
                if (ok) revoke.mutate(row.userId);
              }}
            >
              取消
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="合伙人"
        description="任命合伙人、下发卡密张数与会员天数配额"
        actions={
          <Button onClick={() => setAppointing(true)}>
            <UserPlus />
            设为合伙人
          </Button>
        }
      />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索用户名 / 邮箱" className="h-8 pl-8 text-xs" />
        </div>
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: '生效中' },
            { value: 'revoked', label: '已撤销' },
            { value: 'all', label: '全部档案' },
          ]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.userId}
        loading={list.isLoading}
        refreshing={list.isFetching && !list.isLoading}
        skeletonRows={PAGE_SIZE}
        emptyText="还没有合伙人"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />

      <AppointDialog
        open={appointing}
        onClose={() => setAppointing(false)}
        onDone={async () => {
          setAppointing(false);
          await invalidate();
        }}
      />
      <EditDialog
        partner={editing}
        onClose={() => setEditing(null)}
        onDone={async () => {
          setEditing(null);
          await invalidate();
        }}
      />
      <DetailDialog userId={detailId} onClose={() => setDetailId(null)} />
      {dialog}
    </div>
  );
}

function AppointDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [q, setQ] = React.useState('');
  const [user, setUser] = React.useState<AdminUserRow | null>(null);
  const [level, setLevel] = React.useState<'standard' | 'plus'>('standard');
  const [codeQuota, setCodeQuota] = React.useState('20');
  const [daysQuota, setDaysQuota] = React.useState('365');
  const [note, setNote] = React.useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 300);

  const users = useQuery({
    queryKey: ['admin-users-pick', debouncedQ],
    queryFn: () => usersApi.list({ page: 1, pageSize: 8, q: debouncedQ || undefined }),
    enabled: open && debouncedQ.length >= 1,
  });

  const appoint = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('请先选择用户');
      const codes = Number(codeQuota);
      const days = Number(daysQuota);
      if (!Number.isFinite(codes) || codes < 0 || !Number.isFinite(days) || days < 0) {
        throw new Error('请填写有效的配额');
      }
      return partnersApi.appoint({
        userId: user.id,
        level,
        codeQuota: codes,
        daysQuota: days,
        note: note.trim() || undefined,
      });
    },
    onSuccess: async () => {
      toast.success('已设为合伙人');
      await onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  React.useEffect(() => {
    if (!open) {
      setQ('');
      setUser(null);
      setLevel('standard');
      setCodeQuota('20');
      setDaysQuota('365');
      setNote('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>设为合伙人</DialogTitle>
          <DialogDescription>从站内用户中选择，并下发卡密张数与可发放会员天数。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="搜索用户">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="用户名或邮箱" />
          </Field>
          {user ? (
            <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
              <span>
                {user.displayName} <span className="text-muted-foreground">@{user.username}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setUser(null)}>
                重选
              </Button>
            </div>
          ) : (
            <div className="max-h-40 space-y-1 overflow-auto">
              {(users.data?.items ?? []).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => setUser(row)}
                >
                  <Handshake className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{row.displayName}</span>
                  <span className="text-muted-foreground">@{row.username}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="等级">
              <Select value={level} onValueChange={(v) => setLevel(v as 'standard' | 'plus')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">普通合伙人</SelectItem>
                  <SelectItem value="plus">核心合伙人</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="卡密张数">
              <Input inputMode="numeric" value={codeQuota} onChange={(e) => setCodeQuota(e.target.value)} />
            </Field>
            <Field label="可发放天数">
              <Input inputMode="numeric" value={daysQuota} onChange={(e) => setDaysQuota(e.target.value)} />
            </Field>
          </div>
          <Field label="备注">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!user || appoint.isPending} onClick={() => appoint.mutate()}>
            确认任命
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  partner,
  onClose,
  onDone,
}: {
  partner: AdminPartnerRow | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [level, setLevel] = React.useState<'standard' | 'plus'>('standard');
  const [codeQuota, setCodeQuota] = React.useState('0');
  const [daysQuota, setDaysQuota] = React.useState('0');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!partner) return;
    setLevel(partner.level);
    setCodeQuota(String(partner.codeQuota));
    setDaysQuota(String(partner.daysQuota));
    setNote(partner.note ?? '');
  }, [partner]);

  const save = useMutation({
    mutationFn: () =>
      partnersApi.update(partner!.userId, {
        level,
        codeQuota: Number(codeQuota),
        daysQuota: Number(daysQuota),
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      toast.success('配额已更新');
      await onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={partner !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整合伙人配额</DialogTitle>
          <DialogDescription>{partner ? `${partner.displayName} · 已占用 ${partner.codesIssued} 张 / ${partner.daysIssued} 天` : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="等级">
            <Select value={level} onValueChange={(v) => setLevel(v as 'standard' | 'plus')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">普通合伙人</SelectItem>
                <SelectItem value="plus">核心合伙人</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="卡密张数">
            <Input inputMode="numeric" value={codeQuota} onChange={(e) => setCodeQuota(e.target.value)} />
          </Field>
          <Field label="可发放天数">
            <Input inputMode="numeric" value={daysQuota} onChange={(e) => setDaysQuota(e.target.value)} />
          </Field>
        </div>
        <Field label="备注">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['admin-partner-detail', userId],
    queryFn: () => partnersApi.detail(userId!),
    enabled: Boolean(userId),
  });
  const partner = detail.data?.partner;

  return (
    <Dialog open={userId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>{partner ? partner.displayName : '合伙人明细'}</DialogTitle>
          <DialogDescription>
            {partner
              ? `${partnerLevelLabel(partner.level)} · 客户 ${partner.customerCount} · 收入 ${formatCents(partner.revenueCents)}`
              : '加载中'}
          </DialogDescription>
        </DialogHeader>
        {partner ? (
          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
              <div>
                卡密 {partner.codesIssued}/{partner.codeQuota}，剩 {partner.codeRemaining}
              </div>
              <div>
                天数 {partner.daysIssued}/{partner.daysQuota}，剩 {partner.daysRemaining}
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">任命于 {formatDateTime(partner.appointedAt)}</div>
            </div>
            <div>
              <p className="mb-2 font-medium">最近客户</p>
              <div className="max-h-40 space-y-1 overflow-auto">
                {(detail.data?.customers ?? []).map((c) => (
                  <div key={c.userId} className="flex justify-between text-xs">
                    <span>@{c.username}</span>
                    <span className={c.isExpired ? 'text-destructive' : 'text-muted-foreground'}>
                      {c.vipExpiresAt ? formatDateTime(c.vipExpiresAt) : '无到期'}
                    </span>
                  </div>
                ))}
                {(detail.data?.customers ?? []).length === 0 ? <p className="text-xs text-muted-foreground">暂无客户</p> : null}
              </div>
            </div>
            <div>
              <p className="mb-2 font-medium">最近卡密</p>
              <div className="max-h-40 space-y-1 overflow-auto font-mono text-xs">
                {(detail.data?.codes ?? []).map((c) => (
                  <div key={c.id} className="flex justify-between gap-2">
                    <span>{c.code}</span>
                    <span className="text-muted-foreground">{c.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
