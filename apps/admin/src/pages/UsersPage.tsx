import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Search, ShieldBan, ShieldCheck, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
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
  useDebouncedValue,
} from '@videox/ui';
import { usersApi, type AdminUserRow } from '../lib/api';
import { formatDate, formatDateTime, formatNumber } from '../lib/format';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { RoleBadge, StatusBadge } from '../components/StatusBadge';
import { FilterSelect } from './VideosPage';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuthStore } from '../stores/auth';

const PAGE_SIZE = 20;

export function UsersPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const me = useAuthStore((s) => s.user);

  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [vipOnly, setVipOnly] = React.useState('all');
  const [granting, setGranting] = React.useState<AdminUserRow | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, role, status, vipOnly]);

  const list = useQuery({
    queryKey: ['admin-users', { page, debouncedQ, role, status, vipOnly }],
    queryFn: () =>
      usersApi.list({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        role: role === 'all' ? undefined : role,
        status: status === 'all' ? undefined : status,
        vipOnly: vipOnly === 'vip' ? true : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => usersApi.update(id, body),
    onSuccess: async () => {
      toast.success('已更新');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeVip = useMutation({
    mutationFn: (id: string) => usersApi.revokeVip(id),
    onSuccess: async () => {
      toast.success('已取消会员资格');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => usersApi.bulkDelete(ids),
    onSuccess: async (res) => {
      toast.success(`已删除 ${res.deleted} 个用户`);
      setSelected(new Set());
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runBulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const skippingSelf = Boolean(me && selected.has(me.id));
    const ok = await confirm({
      title: `删除 ${ids.length} 个用户？`,
      description: skippingSelf
        ? '将永久删除选中账号及其观看记录、评论等。当前登录账号会自动跳过。此操作不可撤销。'
        : '将永久删除选中账号及其观看记录、评论等。此操作不可撤销。',
      confirmText: '删除',
      destructive: true,
    });
    if (ok) bulkDelete.mutate(ids);
  };

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'user',
      header: '用户',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={row.avatarUrl ?? undefined} alt={row.displayName} />
            <AvatarFallback>{row.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              @{row.username} · {row.email}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: '角色', cell: (row) => <RoleBadge role={row.role} /> },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'vip',
      header: '会员',
      cell: (row) =>
        row.isVip ? (
          <span className="text-emerald-600 tabular-nums dark:text-emerald-400">至 {formatDate(row.vipExpiresAt)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'stats',
      header: '内容 / 粉丝',
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">
          {formatNumber(row.videoCount)} / {formatNumber(row.followerCount)}
        </span>
      ),
    },
    {
      key: 'time',
      header: '最近登录 / 注册',
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(row.lastLoginAt)}
          <br />
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-56',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Select value={row.role} onValueChange={(value) => update.mutate({ id: row.id, body: { role: value } })}>
            <SelectTrigger size="sm" className="h-7 w-22 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">普通</SelectItem>
              <SelectItem value="vip">会员</SelectItem>
              <SelectItem value="admin">管理员</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="icon" title="赠送会员" onClick={() => setGranting(row)}>
            <Crown className="size-3.5" />
          </Button>

          {row.isVip ? (
            <Button
              variant="ghost"
              size="icon"
              title="取消会员"
              onClick={async () => {
                const ok = await confirm({
                  title: '取消会员资格？',
                  description: `${row.displayName} 将立即失去会员权益。`,
                  confirmText: '取消会员',
                  destructive: true,
                });
                if (ok) revokeVip.mutate(row.id);
              }}
            >
              <ShieldBan className="size-3.5 text-destructive" />
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            title={row.status === 'banned' ? '解封' : '封禁'}
            onClick={async () => {
              const banning = row.status !== 'banned';
              if (banning) {
                const ok = await confirm({
                  title: '封禁该用户？',
                  description: `${row.displayName} 将无法登录与互动。`,
                  confirmText: '封禁',
                  destructive: true,
                });
                if (!ok) return;
              }
              update.mutate({ id: row.id, body: { status: banning ? 'banned' : 'active' } });
            }}
          >
            {row.status === 'banned' ? (
              <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldBan className="size-3.5" />
            )}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="用户管理" description="角色、封禁与手动赠送会员" />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索用户名 / 邮箱" className="h-8 pl-8 text-xs" />
        </div>
        <FilterSelect
          value={role}
          onChange={setRole}
          options={[
            { value: 'all', label: '全部角色' },
            { value: 'user', label: '普通用户' },
            { value: 'vip', label: '会员' },
            { value: 'admin', label: '管理员' },
          ]}
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '正常' },
            { value: 'banned', label: '已封禁' },
            { value: 'pending', label: '待激活' },
          ]}
        />
        <FilterSelect
          value={vipOnly}
          onChange={setVipOnly}
          options={[
            { value: 'all', label: '全部' },
            { value: 'vip', label: '仅有效会员' },
          ]}
        />
      </FilterBar>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span className="text-xs font-medium tabular-nums">已选 {selected.size} 项</span>
          <span className="mx-1 h-4 w-px bg-border" />
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
        emptyText="没有符合条件的用户"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />

      <GrantVipDialog user={granting} onClose={() => setGranting(null)} onGranted={() => void invalidate()} />
      {dialog}
    </div>
  );
}

function GrantVipDialog({
  user,
  onClose,
  onGranted,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [days, setDays] = React.useState('30');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (user) {
      setDays('30');
      setNote('');
    }
  }, [user]);

  const grant = useMutation({
    mutationFn: () => usersApi.grantVip({ userId: user!.id, days: Number(days), note: note.trim() || undefined }),
    onSuccess: (res) => {
      toast.success(`已开通，会员到期 ${formatDate(res.vipExpiresAt)}`);
      onGranted();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validDays = Number(days) > 0 && Number.isInteger(Number(days));

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>赠送会员</DialogTitle>
          <DialogDescription>
            为 {user?.displayName} 手动增加会员时长{user?.isVip ? '，将在现有到期时间上顺延' : ''}。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <Field label="天数">
            <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[7, 30, 90, 365].map((preset) => (
              <Button key={preset} variant="outline" size="sm" onClick={() => setDays(String(preset))}>
                {preset} 天
              </Button>
            ))}
          </div>
          <Field label="备注" hint="会写入订单流水，便于对账">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：客服补偿" />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!validDays || grant.isPending} onClick={() => grant.mutate()}>
            确认赠送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
