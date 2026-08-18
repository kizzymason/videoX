import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Flag, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, useDebouncedValue } from '@videox/ui';
import { commentsApi, type AdminCommentRow } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { FilterSelect } from './VideosPage';
import { useConfirm } from '../components/ConfirmDialog';

const PAGE_SIZE = 20;

export function CommentsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');

  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, status]);

  const list = useQuery({
    queryKey: ['admin-comments', { page, debouncedQ, status }],
    queryFn: () =>
      commentsApi.list({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  const moderate = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: 'visible' | 'hidden' | 'deleted' }) =>
      commentsApi.moderate(id, next),
    onSuccess: async () => {
      toast.success('已处理');
      await queryClient.invalidateQueries({ queryKey: ['admin-comments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<AdminCommentRow>[] = [
    {
      key: 'content',
      header: '内容',
      cell: (row) => (
        <div className="min-w-0 max-w-100">
          <p className="line-clamp-2 whitespace-pre-wrap">{row.content}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {row.authorName ?? '已注销用户'}
            {row.authorUsername ? ` @${row.authorUsername}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'video',
      header: '所属视频',
      cell: (row) => <span className="block max-w-50 truncate text-muted-foreground">{row.videoTitle ?? row.videoId}</span>,
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'likes',
      header: '点赞',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatNumber(row.likeCount)}</span>,
    },
    {
      key: 'reports',
      header: '举报',
      cell: (row) =>
        row.reportCount > 0 ? (
          <span className="flex items-center gap-1 text-destructive tabular-nums">
            <Flag className="size-3" />
            {row.reportCount}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'createdAt',
      header: '时间',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-28',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          {row.status !== 'visible' ? (
            <Button
              variant="ghost"
              size="icon"
              title="恢复显示"
              onClick={() => moderate.mutate({ id: row.id, status: 'visible' })}
            >
              <Eye className="size-3.5" />
            </Button>
          ) : null}
          {row.status !== 'hidden' ? (
            <Button variant="ghost" size="icon" title="隐藏" onClick={() => moderate.mutate({ id: row.id, status: 'hidden' })}>
              <EyeOff className="size-3.5" />
            </Button>
          ) : null}
          {row.status !== 'deleted' ? (
            <Button
              variant="ghost"
              size="icon"
              title="删除"
              onClick={async () => {
                const ok = await confirm({
                  title: '删除该评论？',
                  description: '评论会对所有人不可见，作者也无法恢复。',
                  confirmText: '删除',
                  destructive: true,
                });
                if (ok) moderate.mutate({ id: row.id, status: 'deleted' });
              }}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="评论审核" description="按状态筛选，处理举报与违规内容" />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索评论内容" className="h-8 pl-8 text-xs" />
        </div>
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'visible', label: '已显示' },
            { value: 'hidden', label: '已隐藏' },
            { value: 'deleted', label: '已删除' },
          ]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        refreshing={list.isFetching && !list.isLoading}
        skeletonRows={PAGE_SIZE}
        emptyText="没有符合条件的评论"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />
      {dialog}
    </div>
  );
}
