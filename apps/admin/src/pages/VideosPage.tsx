import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Category, VideoSummary } from '@videox/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDebouncedValue,
} from '@videox/ui';
import { catalogApi, videosApi, type BulkAction } from '../lib/api';
import { formatDateTime, formatDuration, formatNumber } from '../lib/format';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { AccessBadge, StatusBadge } from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';
import { VideoEditDialog } from '../components/VideoEditDialog';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'ready', label: '已就绪' },
  { value: 'partially_ready', label: '可播(补档中)' },
  { value: 'transcoding', label: '转码中' },
  { value: 'uploading', label: '上传中' },
  { value: 'failed', label: '转码失败' },
  { value: 'archived', label: '已归档' },
];

const ACCESS_OPTIONS = [
  { value: 'all', label: '全部权限' },
  { value: 'vip', label: '会员专享' },
];

const VISIBILITY_OPTIONS = [
  { value: 'all', label: '全部可见性' },
  { value: 'public', label: '公开' },
  { value: 'unlisted', label: '不公开' },
  { value: 'private', label: '私密' },
];

export function VideosPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [accessLevel, setAccessLevel] = React.useState('all');
  const [visibility, setVisibility] = React.useState('all');
  const [categoryId, setCategoryId] = React.useState('all');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<VideoSummary | null>(null);

  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, status, accessLevel, visibility, categoryId]);

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories, staleTime: 5 * 60_000 });

  const list = useQuery({
    queryKey: ['admin-videos', { page, debouncedQ, status, accessLevel, visibility, categoryId }],
    queryFn: () =>
      videosApi.list({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
        accessLevel: accessLevel === 'all' ? undefined : accessLevel,
        visibility: visibility === 'all' ? undefined : visibility,
        categoryId: categoryId === 'all' ? undefined : categoryId,
        sort: 'latest',
        kind: 'vod',
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-videos'] });

  const bulk = useMutation({
    mutationFn: (body: { ids: string[]; action: BulkAction; accessLevel?: string; categoryId?: string }) =>
      videosApi.bulk(body),
    onSuccess: async (res) => {
      toast.success(`已处理 ${res.affected} 个视频`);
      setSelected(new Set());
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => videosApi.remove(id),
    onSuccess: async () => {
      toast.success('视频已删除');
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

  const runBulk = async (action: BulkAction, extra?: { accessLevel?: string; categoryId?: string }) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === 'delete') {
      const ok = await confirm({
        title: `删除 ${ids.length} 个视频？`,
        description: '视频记录与转码产物都会被清理，操作不可撤销。',
        confirmText: '删除',
        destructive: true,
      });
      if (!ok) return;
    }
    bulk.mutate({ ids, action, ...extra });
  };

  const columns: Column<VideoSummary>[] = [
    {
      key: 'title',
      header: '视频',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {row.posterUrl ? (
            <img src={row.posterUrl} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded object-cover" />
          ) : (
            <span className="h-9 w-16 shrink-0 rounded bg-muted" />
          )}
          <div className="min-w-0">
            <p className="max-w-70 truncate font-medium">{row.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.author?.displayName ?? '未知作者'}
              {row.durationSeconds > 0 ? ` · ${formatDuration(row.durationSeconds)}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: '分类',
      cell: (row) => <span className="text-muted-foreground">{row.category?.name ?? '—'}</span>,
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} kind="video" /> },
    { key: 'access', header: '权限', cell: (row) => <AccessBadge level={row.accessLevel} /> },
    {
      key: 'visibility',
      header: '可见性',
      cell: (row) => <StatusBadge status={row.visibility} />,
    },
    {
      key: 'stats',
      header: '数据',
      cell: (row) => (
        <span className="text-muted-foreground tabular-nums">
          {formatNumber(row.viewCount)} 播放 · {formatNumber(row.likeCount)} 赞
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '发布时间',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatDateTime(row.publishedAt ?? row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-30',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" title="编辑" onClick={() => setEditing(row)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" title="重新转码" onClick={() => retranscode.mutate(row.id)}>
            <RotateCcw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" title="前台预览" asChild>
            <a href={`http://localhost:5173/watch/${row.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="删除"
            onClick={async () => {
              const ok = await confirm({
                title: '删除该视频？',
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
        title="视频管理"
        description="筛选、批量操作与元数据编辑"
        actions={
          <Button size="sm" asChild>
            <Link to="/upload">上传视频</Link>
          </Button>
        }
      />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect value={accessLevel} onChange={setAccessLevel} options={ACCESS_OPTIONS} />
        <FilterSelect value={visibility} onChange={setVisibility} options={VISIBILITY_OPTIONS} />
        <FilterSelect
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: 'all', label: '全部分类' },
            ...(categories ?? []).map((c: Category) => ({ value: c.id, label: c.name })),
          ]}
        />
      </FilterBar>

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
          <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('archive')}>
            归档
          </Button>
          <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => void runBulk('retranscode')}>
            重新转码
          </Button>
          <Select onValueChange={() => void runBulk('set_access', { accessLevel: 'vip' })}>
            <SelectTrigger size="sm" className="h-8 w-32 text-xs">
              <SelectValue placeholder="设为权限…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vip">会员专享</SelectItem>
            </SelectContent>
          </Select>
          <Select onValueChange={(value) => void runBulk('set_category', { categoryId: value })}>
            <SelectTrigger size="sm" className="h-8 w-32 text-xs">
              <SelectValue placeholder="移动到分类…" />
            </SelectTrigger>
            <SelectContent>
              {(categories ?? []).map((c: Category) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        emptyText="没有符合条件的视频"
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

export function FilterSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={className ?? 'h-8 w-36 text-xs'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
