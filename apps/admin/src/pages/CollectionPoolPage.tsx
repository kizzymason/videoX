// ========================================================================
// 采集系统 - 号池管理页面（账号列表 / 批量导入 / 健康检查 / 编辑 / 删除）
// ========================================================================

import * as React from 'react';
import { KeyRound, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { PageMeta } from '@videox/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@videox/ui';
import { DataTable, Pagination, type Column } from '@/components/DataTable';
import { FilterBar, PageHeader } from '@/components/Page';
import {
  collectionApi,
  type PoolAccountRow,
  type PoolStats,
  type TokenMonitorSnapshot,
} from '@/lib/api';

const FRESH_SECONDS = 4 * 60;
const STALE_SECONDS = 10 * 60;

function formatDelta(ms: number, suffix: string): string {
  const abs = Math.abs(ms);
  if (abs < 10_000) return suffix === '前' ? '刚刚' : '即将开始';
  if (abs < 60_000) return `${Math.floor(abs / 1000)} 秒${suffix}`;
  if (abs < 3600_000) return `${Math.floor(abs / 60_000)} 分钟${suffix}`;
  if (abs < 86400_000) return `${Math.floor(abs / 3600_000)} 小时${suffix}`;
  return new Date(Date.now() + (suffix === '后' ? abs : -abs)).toLocaleString('zh-CN');
}

function relativeTime(value: string | null | undefined, now: number): string {
  if (!value) return '尚未发生';
  const ms = now - new Date(value).getTime();
  if (Number.isNaN(ms)) return '—';
  return formatDelta(ms, '前');
}

function upcomingTime(value: string | null | undefined, now: number): string {
  if (!value) return '尚未排期';
  const ms = new Date(value).getTime() - now;
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return '已到期，下次取号或巡检时执行';
  return formatDelta(ms, '后');
}

function formatAge(seconds: number | null, nowTokenUpdatedAt: string | null, now: number): string {
  const age =
    seconds ??
    (nowTokenUpdatedAt ? Math.max(0, Math.floor((now - new Date(nowTokenUpdatedAt).getTime()) / 1000)) : null);
  if (age === null) return '未记录';
  if (age < 60) return `${age} 秒前`;
  if (age < 3600) return `${Math.floor(age / 60)} 分钟前`;
  return `${Math.floor(age / 3600)} 小时前`;
}

function freshnessOf(account: PoolAccountRow, now: number): PoolAccountRow['tokenFreshness'] {
  if (account.tokenFreshness) return account.tokenFreshness;
  if (!account.tokenUpdatedAt) return 'unknown';
  const age = Math.max(0, Math.floor((now - new Date(account.tokenUpdatedAt).getTime()) / 1000));
  if (age < FRESH_SECONDS) return 'fresh';
  if (age < STALE_SECONDS) return 'due';
  return 'stale';
}

function freshnessLabel(value: PoolAccountRow['tokenFreshness']): string {
  if (value === 'fresh') return '新鲜';
  if (value === 'due') return '待自动续';
  if (value === 'stale') return '已偏旧';
  return '未知';
}

function sourceLabel(source: string | null): string {
  if (source === 'checkout') return '采集取号';
  if (source === 'health_check') return '健康巡检';
  if (source === 'manual') return '手动刷新';
  if (source === 'credentials_update') return '更新凭据';
  if (source === 'login') return '账号登录';
  return '系统';
}

const STATUS_TEXT: Record<string, string> = {
  active: '有效',
  inactive: '失效',
  banned: '封禁',
};

interface ImportDraft {
  uid: string;
  token: string;
  username?: string;
  isVip: boolean;
}

interface EditDraft {
  username: string;
  status: 'active' | 'inactive' | 'banned';
  isVip: boolean;
}

interface CredentialDraft {
  username: string;
  password: string;
}

export function CollectionPoolPage() {
  const [accounts, setAccounts] = React.useState<PoolAccountRow[]>([]);
  const [meta, setMeta] = React.useState<PageMeta | null>(null);
  const [stats, setStats] = React.useState<PoolStats | null>(null);
  const [monitor, setMonitor] = React.useState<TokenMonitorSnapshot | null>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [filterStatus, setFilterStatus] = React.useState('all');
  const [filterVip, setFilterVip] = React.useState('all');
  const [filterWatch, setFilterWatch] = React.useState('all');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());

  // 导入弹窗
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [credentialOpen, setCredentialOpen] = React.useState(false);
  const [credentialDraft, setCredentialDraft] = React.useState<CredentialDraft>({ username: '', password: '' });
  const [addingCredentials, setAddingCredentials] = React.useState(false);

  // 编辑弹窗
  const [editTarget, setEditTarget] = React.useState<PoolAccountRow | null>(null);
  const [editDraft, setEditDraft] = React.useState<EditDraft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const pageSize = 20;

  const fetchAccounts = React.useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await collectionApi.pools({
        page,
        pageSize,
        ...(filterStatus !== 'all' && { status: filterStatus }),
        ...(filterVip !== 'all' && { isVip: filterVip }),
        ...(search && { search }),
      });
      setAccounts(result.items);
      setMeta(result.meta);
    } catch (error) {
      console.error('获取账号列表失败:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, filterStatus, filterVip, search]);

  const fetchStats = React.useCallback(async () => {
    try {
      setStats(await collectionApi.poolStats());
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  }, []);

  const fetchMonitor = React.useCallback(async () => {
    try {
      setMonitor(await collectionApi.tokenMonitor());
    } catch (error) {
      console.error('获取 token 监控失败:', error);
    }
  }, []);

  React.useEffect(() => {
    void fetchAccounts();
    void fetchStats();
    void fetchMonitor();
  }, [fetchAccounts, fetchStats, fetchMonitor]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      void fetchAccounts(true);
      void fetchStats();
      void fetchMonitor();
    }, 15_000);
    return () => clearInterval(timer);
  }, [fetchAccounts, fetchStats, fetchMonitor]);

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleImport() {
    const lines = importText.trim().split('\n').filter(Boolean);
    const drafts: ImportDraft[] = [];
    for (const line of lines) {
      const [uid, token, username] = line.split('|').map((p) => p?.trim());
      if (!uid || !token) continue;
      drafts.push({ uid, token, username: username || undefined, isVip: false });
    }
    if (drafts.length === 0) return;

    setImporting(true);
    try {
      const result = await collectionApi.importPools(drafts);
      setImportOpen(false);
      setImportText('');
      window.alert(`成功导入 ${result.ids.length} 个账号`);
      await Promise.all([fetchAccounts(), fetchStats(), fetchMonitor()]);
    } catch (error) {
      console.error('导入失败:', error);
      window.alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleAddCredentials() {
    if (!credentialDraft.username.trim() || !credentialDraft.password) return;
    setAddingCredentials(true);
    try {
      await collectionApi.addCredentialPool({
        username: credentialDraft.username.trim(),
        password: credentialDraft.password,
      });
      setCredentialOpen(false);
      setCredentialDraft({ username: '', password: '' });
      window.alert('登录成功，账号已加入号池');
      await Promise.all([fetchAccounts(), fetchStats(), fetchMonitor()]);
    } catch (error) {
      console.error('添加账号失败:', error);
      window.alert(`添加失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAddingCredentials(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确定要删除这个账号吗？')) return;
    try {
      await collectionApi.deletePool(id);
      await Promise.all([fetchAccounts(), fetchStats(), fetchMonitor()]);
    } catch (error) {
      console.error('删除失败:', error);
    }
  }

  async function handleHealthCheck() {
    try {
      const result = await collectionApi.healthCheck();
      const valid = result.valid ?? result.valid_count ?? 0;
      window.alert(`健康检查完成：${valid} 有效 / ${result.invalid ?? 0} 失效 / ${result.failed ?? 0} 检查失败`);
      await Promise.all([fetchAccounts(), fetchStats(), fetchMonitor()]);
    } catch (error) {
      console.error('健康检查失败:', error);
      window.alert(`健康检查失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleRefresh(account: PoolAccountRow) {
    try {
      await collectionApi.refreshPool(account.id);
      await Promise.all([fetchAccounts(), fetchStats(), fetchMonitor()]);
    } catch (error) {
      window.alert(`刷新失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleSaveEdit() {
    if (!editTarget || !editDraft) return;
    setSaving(true);
    try {
      await collectionApi.updatePool(editTarget.id, {
        username: editDraft.username || null,
        status: editDraft.status,
        isVip: editDraft.isVip,
      });
      setEditTarget(null);
      setEditDraft(null);
      await Promise.all([fetchAccounts(), fetchMonitor()]);
    } catch (error) {
      console.error('保存失败:', error);
      window.alert(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(account: PoolAccountRow) {
    setEditTarget(account);
    setEditDraft({
      username: account.username ?? '',
      status: account.status,
      isVip: account.isVip,
    });
  }

  const statCards: Array<{ label: string; value: number; className: string }> = stats
    ? [
        { label: '总数', value: stats.total, className: '' },
        { label: '有效', value: stats.active, className: 'text-green-600' },
        { label: '失效', value: stats.inactive, className: 'text-yellow-600' },
        { label: '封禁', value: stats.banned, className: 'text-red-600' },
        { label: 'VIP', value: stats.vip, className: 'text-purple-600' },
        { label: '普通', value: stats.free, className: 'text-muted-foreground' },
      ]
    : [];

  const visibleAccounts = accounts.filter((a) => {
    if (filterWatch === 'auto') return a.hasCredentials;
    if (filterWatch === 'static') return !a.hasCredentials;
    return true;
  });

  const columns: Array<Column<PoolAccountRow>> = [
    { key: 'uid', header: 'UID', cell: (a) => <span className="font-mono text-xs">{a.uid}</span> },
    { key: 'username', header: '用户名', cell: (a) => a.username || a.loginUsername || '—' },
    {
      key: 'watch',
      header: '自动取 Token',
      cell: (a) =>
        a.hasCredentials ? (
          <div className="space-y-1">
            <Badge className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" variant="outline">
              {a.autoRefreshEnabled ? '监控中' : '已托管（未启用）'}
            </Badge>
            <div className="text-[11px] text-muted-foreground">凭据 {a.loginUsername || '已保存'}</div>
          </div>
        ) : (
          <div className="space-y-1">
            <Badge variant="secondary">仅静态 Token</Badge>
            <div className="text-[11px] text-muted-foreground">过期后不会自动续</div>
          </div>
        ),
    },
    {
      key: 'freshness',
      header: 'Token 新鲜度',
      cell: (a) => {
        const freshness = freshnessOf(a, now);
        const age = a.tokenUpdatedAt
          ? Math.max(0, Math.floor((now - new Date(a.tokenUpdatedAt).getTime()) / 1000))
          : a.tokenAgeSeconds;
        const used = Math.min(100, Math.round(((age ?? 0) / FRESH_SECONDS) * 100));
        const bar =
          freshness === 'fresh' ? 'bg-emerald-500' : freshness === 'due' ? 'bg-amber-500' : 'bg-red-500';
        return (
          <div className="min-w-[160px] space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span
                className={
                  freshness === 'fresh'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : freshness === 'due'
                      ? 'text-amber-700 dark:text-amber-300'
                      : freshness === 'stale'
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                }
              >
                {freshnessLabel(freshness)}
              </span>
              <span className="text-muted-foreground">{formatAge(age, a.tokenUpdatedAt, now)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full ${bar}`} style={{ width: `${used}%` }} />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {a.hasCredentials
                ? a.nextSilentRefreshAt
                  ? `静默刷新 ${upcomingTime(a.nextSilentRefreshAt, now)}`
                  : '下次取号时会自动登录续期'
                : '需要补账号密码才会自动续'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'isVip',
      header: '账号类型',
      cell: (a) => <Badge variant={a.isVip ? 'default' : 'secondary'}>{a.isVip ? 'VIP' : '普通'}</Badge>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (a) => (
        <Badge
          variant={a.status === 'active' ? 'outline' : a.status === 'inactive' ? 'secondary' : 'destructive'}
        >
          {STATUS_TEXT[a.status] ?? a.status}
        </Badge>
      ),
    },
    { key: 'usageCount', header: '使用次数', cell: (a) => a.usageCount },
    {
      key: 'lastUsedAt',
      header: '巡检 / 使用',
      cell: (a) => (
        <div className="text-xs leading-5">
          <div>巡检 {relativeTime(a.lastCheckAt, now)}</div>
          <div className="text-muted-foreground">
            {a.lastUsedAt ? `使用 ${relativeTime(a.lastUsedAt, now)}` : '从未使用'}
            {a.consecutiveFailures > 0 ? ` · 连续失败 ${a.consecutiveFailures}` : ''}
          </div>
          {a.lastError ? <div className="max-w-[220px] truncate text-red-600">{a.lastError}</div> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      cell: (a) => (
        <div className="flex items-center gap-1">
          {a.hasCredentials ? (
            <Button variant="ghost" size="sm" onClick={() => void handleRefresh(a)} aria-label="刷新 token">
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => openEdit(a)} aria-label="编辑账号">
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700"
            onClick={() => void handleDelete(a.id)}
            aria-label="删除账号"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="采集号池管理"
        description="账号密码入库后会自动监控并续 token；本页每 15 秒刷新一次监控状态"
        actions={
          <>
            <Button variant="outline" onClick={() => void handleHealthCheck()}>
              <RefreshCw className="mr-2 size-4" />
              健康检查
            </Button>
            <Button onClick={() => setCredentialOpen(true)}>
              <Plus className="mr-2 size-4" />
              账号登录添加
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Plus className="mr-2 size-4" />
              批量导入
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              自动取 Token 监控
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {refreshing ? '正在同步…' : '实时 · 每 15 秒刷新'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">托管密码 / 自动续期</div>
            <div className="mt-1 text-2xl font-bold">
              {monitor ? `${monitor.counts.autoRefreshReady}/${monitor.counts.total}` : '—'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {monitor
                ? `${monitor.counts.withCredentials} 个已开监控，${monitor.counts.withoutCredentials} 个仅静态 token`
                : '正在读取监控状态'}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Token 新鲜度</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">
              {monitor ? monitor.counts.fresh : '—'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              待续 {monitor?.counts.due ?? 0} · 偏旧 {monitor?.counts.stale ?? 0} · 未知 {monitor?.counts.unknown ?? 0}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">最近号池巡检</div>
            <div className="mt-1 text-lg font-semibold">{relativeTime(monitor?.lastHealthCheckAt, now)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              间隔 {monitor?.healthCheckIntervalMinutes ?? 60} 分钟
              {monitor?.nextHealthCheckAt ? ` · 下次 ${upcomingTime(monitor.nextHealthCheckAt, now)}` : ''}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">静默刷新阈值</div>
            <div className="mt-1 text-2xl font-bold">{Math.round((monitor?.silentRefreshAfterSeconds ?? FRESH_SECONDS) / 60)} 分钟</div>
            <div className="mt-1 text-xs text-muted-foreground">
              采集取号时超过此时长会自动登录换新 token
            </div>
          </div>
        </CardContent>
      </Card>

      {stats ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {statCards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{card.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${card.className}`}>{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* 筛选器 */}
      <FilterBar>
        <form
          className="relative w-64"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput);
          }}
        >
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索 UID 或用户名…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </form>
        <Select
          value={filterStatus}
          onValueChange={(v) => {
            setPage(1);
            setFilterStatus(v);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="所有状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有状态</SelectItem>
            <SelectItem value="active">有效</SelectItem>
            <SelectItem value="inactive">失效</SelectItem>
            <SelectItem value="banned">封禁</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterVip}
          onValueChange={(v) => {
            setPage(1);
            setFilterVip(v);
          }}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="账号类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">VIP</SelectItem>
            <SelectItem value="false">普通</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterWatch}
          onValueChange={(v) => {
            setPage(1);
            setFilterWatch(v);
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="监控状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部监控状态</SelectItem>
            <SelectItem value="auto">自动取 Token</SelectItem>
            <SelectItem value="static">仅静态 Token</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={visibleAccounts}
        rowKey={(a) => a.id}
        loading={loading}
        refreshing={refreshing}
        emptyText="号池为空，点击右上角「账号登录添加」开启自动取 token"
      />
      <Pagination meta={meta ?? undefined} onChange={setPage} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4" />
            最近自动取 Token
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!monitor || monitor.events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              还没有自动取 token 记录。用账号密码添加账号、手动刷新或等待巡检后会出现在这里。
            </p>
          ) : (
            <ul className="divide-y">
              {monitor.events.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          event.level === 'error'
                            ? 'border-transparent bg-destructive/12 text-destructive'
                            : event.level === 'warn'
                              ? 'border-transparent bg-amber-500/12 text-amber-700'
                              : 'border-transparent bg-emerald-500/12 text-emerald-700'
                        }
                      >
                        {event.event === 'pool_health_check'
                          ? '号池巡检'
                          : event.event === 'token_login'
                            ? '登录入库'
                            : event.event === 'token_refresh_failed'
                              ? '续期失败'
                              : '自动续 token'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{sourceLabel(event.source)}</span>
                      {event.uid ? <span className="font-mono text-xs">{event.uid}</span> : null}
                    </div>
                    <p className="mt-1 text-muted-foreground">{event.message}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(event.createdAt, now)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 账号密码登录弹窗 */}
      <Dialog open={credentialOpen} onOpenChange={setCredentialOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>账号登录添加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="credential-username">账号</Label>
              <Input
                id="credential-username"
                autoComplete="username"
                value={credentialDraft.username}
                onChange={(e) => setCredentialDraft((d) => ({ ...d, username: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-password">密码</Label>
              <Input
                id="credential-password"
                type="password"
                autoComplete="current-password"
                value={credentialDraft.password}
                onChange={(e) => setCredentialDraft((d) => ({ ...d, password: e.target.value }))}
              />
            </div>
            <Button onClick={() => void handleAddCredentials()} className="w-full" disabled={addingCredentials}>
              {addingCredentials ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              登录并加入号池
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 批量导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>批量导入账号</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="import-text">账号列表（每行一个：uid|token|username）</Label>
              <textarea
                id="import-text"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="h-[300px] w-full rounded-md border p-3 font-mono text-sm"
                placeholder={'123456|abcde...f|用户A\n789012|fghij...k|用户B'}
              />
            </div>
            <Button onClick={() => void handleImport()} className="w-full" disabled={importing}>
              {importing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              确认导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑账号弹窗 */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑账号 {editTarget?.uid}</DialogTitle>
          </DialogHeader>
          {editDraft ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input
                  value={editDraft.username}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, username: e.target.value } : d))}
                />
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select
                  value={editDraft.status}
                  onValueChange={(v) =>
                    setEditDraft((d) => (d ? { ...d, status: v as EditDraft['status'] } : d))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">有效</SelectItem>
                    <SelectItem value="inactive">失效</SelectItem>
                    <SelectItem value="banned">封禁</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>账号类型</Label>
                <Select
                  value={editDraft.isVip ? 'vip' : 'free'}
                  onValueChange={(v) => setEditDraft((d) => (d ? { ...d, isVip: v === 'vip' } : d))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vip">VIP</SelectItem>
                    <SelectItem value="free">普通</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void handleSaveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
