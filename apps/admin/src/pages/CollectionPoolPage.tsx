// ========================================================================
// 采集系统 - 号池管理页面（账号列表 / 批量导入 / 健康检查 / 编辑 / 删除）
// ========================================================================

import * as React from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
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
import { collectionApi, type PoolAccountRow, type PoolStats } from '@/lib/api';

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

export function CollectionPoolPage() {
  const [accounts, setAccounts] = React.useState<PoolAccountRow[]>([]);
  const [meta, setMeta] = React.useState<PageMeta | null>(null);
  const [stats, setStats] = React.useState<PoolStats | null>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [filterStatus, setFilterStatus] = React.useState('all');
  const [filterVip, setFilterVip] = React.useState('all');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  // 导入弹窗
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState('');
  const [importing, setImporting] = React.useState(false);

  // 编辑弹窗
  const [editTarget, setEditTarget] = React.useState<PoolAccountRow | null>(null);
  const [editDraft, setEditDraft] = React.useState<EditDraft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const pageSize = 20;

  const fetchAccounts = React.useCallback(async () => {
    setLoading(true);
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
    }
  }, [page, filterStatus, filterVip, search]);

  const fetchStats = React.useCallback(async () => {
    try {
      setStats(await collectionApi.poolStats());
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  }, []);

  React.useEffect(() => {
    void fetchAccounts();
    void fetchStats();
  }, [fetchAccounts, fetchStats]);

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
      await Promise.all([fetchAccounts(), fetchStats()]);
    } catch (error) {
      console.error('导入失败:', error);
      window.alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确定要删除这个账号吗？')) return;
    try {
      await collectionApi.deletePool(id);
      await Promise.all([fetchAccounts(), fetchStats()]);
    } catch (error) {
      console.error('删除失败:', error);
    }
  }

  async function handleHealthCheck() {
    try {
      const result = await collectionApi.healthCheck();
      const valid = result.valid ?? result.valid_count ?? 0;
      window.alert(`健康检查完成：${valid} 有效 / ${result.invalid ?? 0} 失效 / ${result.failed ?? 0} 检查失败`);
      await Promise.all([fetchAccounts(), fetchStats()]);
    } catch (error) {
      console.error('健康检查失败:', error);
      window.alert(`健康检查失败：${error instanceof Error ? error.message : String(error)}`);
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
      await fetchAccounts();
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

  const columns: Array<Column<PoolAccountRow>> = [
    { key: 'uid', header: 'UID', cell: (a) => <span className="font-mono text-xs">{a.uid}</span> },
    { key: 'username', header: '用户名', cell: (a) => a.username || '—' },
    {
      key: 'token',
      header: 'Token',
      cell: (a) => <span className="block max-w-[200px] truncate font-mono text-xs">{a.token.slice(0, 16)}…</span>,
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
      header: '最后使用',
      cell: (a) => (
        <span className="text-xs">
          {a.lastUsedAt ? new Date(a.lastUsedAt).toLocaleString('zh-CN') : '从未'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      cell: (a) => (
        <div className="flex items-center gap-1">
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
        description="管理 yitongkan 网站账号池，用于视频采集与播放地址获取"
        actions={
          <>
            <Button variant="outline" onClick={() => void handleHealthCheck()}>
              <RefreshCw className="mr-2 size-4" />
              健康检查
            </Button>
            <Button onClick={() => setImportOpen(true)}>
              <Plus className="mr-2 size-4" />
              批量导入
            </Button>
          </>
        }
      />

      {/* 统计卡片 */}
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
      </FilterBar>

      <DataTable
        columns={columns}
        rows={accounts}
        rowKey={(a) => a.id}
        loading={loading}
        emptyText="号池为空，点击右上角「批量导入」添加账号"
      />
      <Pagination meta={meta ?? undefined} onChange={setPage} />

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
