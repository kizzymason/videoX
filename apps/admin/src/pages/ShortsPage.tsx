import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { VideoSummary } from '@videox/shared';
import { Button, Input, cn, useDebouncedValue } from '@videox/ui';
import { catalogApi, videosApi, type BulkAction } from '../lib/api';
import { formatDuration, formatNumber } from '../lib/format';
import { PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';
import { VideoEditDialog } from '../components/VideoEditDialog';

const PAGE_SIZE = 20;

const TABS = [
  { key: 'all', label: '全部', visibility: undefined },
  { key: 'pending', label: '待审', visibility: 'unlisted' },
  { key: 'published', label: '已发布', visibility: 'public' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function ShortsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [tab, setTab] = React.useState<TabKey>('all');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<VideoSummary | null>(null);

  const visibility = TABS.find((item) => item.key === tab)?.visibility;
  const debouncedQ = useDebouncedValue(q.trim(), 300);

  React.useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedQ, tab]);

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories, staleTime: 5 * 60_000 });

  const list = useQuery({
    queryKey: ['admin-shorts', { page, debouncedQ, tab }],
    queryFn: () =>
      videosApi.list({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        visibility,
        sort: 'latest',
        kind: 'shorts',
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-shorts'] });

  const bulk = useMutation({
    mutationFn: (body: { ids: string[]; action: BulkAction; accessLevel?: string; categoryId?: string }) =>
      videosApi.bulk(body),
    onSuccess: async (res) => {
      toast.success(`已处理 ${res.affected} 个 Shorts`);
      setSelected(new Set());
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => videosApi.remove(id),
    onSuccess: async () => {
      toast.success('Shorts 已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retranscode = useMutation({
    mutationFn: (id: string) => videosApi.retranscode(id),
    onSuccess: async () => {
      toast.success('已加入转码队列');
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runBulk = async (action: BulkAction) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === 'delete') {
      const ok = await confirm({
        title: `删除 ${ids.length} 个 Shorts？`,
        description: '记录与转码产物都会被清理，操作不可撤销。',
        confirmText: '删除',
        destructive: true,
      });
      if (!ok) return;
    }
    bulk.mutate({ ids, action });
  };

  const columns: Column<VideoSummary>[] = [
    {
      key: 'title',
      header: 'Shorts',
      cell: (row) => {
        const thumb = row.verticalPosterUrl ?? row.posterUrl;
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            {thumb ? (
              <img src={thumb} alt="" loading="lazy" className="h-16 w-9 shrink-0 rounded object-cover" />
            ) : (
              <span className="h-16 w-9 shrink-0 rounded bg-muted" />
            )}
            <p className="max-w-70 truncate font-medium">{row.title}</p>
          </div>
        );
      },
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} kind="video" /> },
    {
      key: 'duration',
      header: '时长',
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">
          {row.durationSeconds > 0 ? formatDuration(row.durationSeconds) : '—'}
        </span>
      ),
    },
    {
      key: 'plays',
      header: '播放',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatNumber(row.viewCount)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-24',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" title="编辑" onClick={() => setEditing(row)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" title="重新转码" onClick={() => retranscode.mutate(row.id)}>
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="删除"
            onClick={async () => {
              const ok = await confirm({
                title: '删除该 Shorts？',
                description: `“${row.title}” 及其转码产物会被一并清理。`,
                confirmText: '删除',
                destructive: true,
              });
              if (ok) remove.mutate(row.id);
            }}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Shorts"
        description="独立竖屏内容，与点播分开管理"
        actions={
          <Button size="sm" asChild>
            <Link to="/upload?kind=shorts">上传 Shorts</Link>
          </Button>
        }
      />

      <div className="mb-3 flex items-center gap-6 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'relative pb-2.5 text-sm transition-colors',
              tab === item.key ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {tab === item.key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" /> : null}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span className="text-xs font-medium tabular-nums">已选 {selected.size} 项</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('publish')}>
            发布
          </Button>
          <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('unpublish')}>
            下架
          </Button>
          <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('retranscode')}>
            重新转码
          </Button>
          <Button variant="destructive" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('delete')}>
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
        emptyText="没有符合条件的 Shorts"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />

      <VideoEditDialog
        video={editing}
        categories={categories ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => void invalidate()}
      />
      {dialog}
    </div>
  );
}
