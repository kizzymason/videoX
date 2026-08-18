import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogEntry } from '@videox/shared';
import { Badge } from '@videox/ui';
import { systemApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';

const PAGE_SIZE = 30;

const ACTION_LABEL: Record<string, string> = {
  'video.update': '编辑视频',
  'video.delete': '删除视频',
  'video.bulk': '批量操作视频',
  'video.retranscode': '重新转码',
  'user.update': '修改用户',
  'user.grant_vip': '赠送会员',
  'user.revoke_vip': '取消会员',
  'comment.moderate': '审核评论',
  'category.create': '新建分类',
  'category.update': '编辑分类',
  'category.delete': '删除分类',
  'tag.delete': '删除标签',
  'banner.create': '新建轮播',
  'banner.update': '编辑轮播',
  'banner.delete': '删除轮播',
  'plan.create': '新建套餐',
  'plan.update': '编辑套餐',
  'plan.delete': '删除套餐',
  'redeem.generate': '生成卡密',
  'redeem.disable': '作废卡密',
  'storage.create': '新建存储',
  'storage.update': '修改存储',
  'storage.activate': '切换存储',
  'storage.delete': '删除存储',
  'settings.site': '修改站点设置',
  'settings.algo': '修改算法权重',
  'ai.create': '新建 AI 配置',
  'ai.update': '修改 AI 配置',
  'ai.delete': '删除 AI 配置',
  'ai.run': '触发 AI 跑批',
};

export function AuditLogsPage() {
  const [page, setPage] = React.useState(1);

  const list = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => systemApi.auditLogs(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'createdAt',
      header: '时间',
      headClassName: 'w-36',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'actor',
      header: '操作人',
      cell: (row) => <span>{row.actorName ?? '系统'}</span>,
    },
    {
      key: 'action',
      header: '动作',
      cell: (row) => (
        <Badge variant="outline" className="font-normal">
          {ACTION_LABEL[row.action] ?? row.action}
        </Badge>
      ),
    },
    {
      key: 'target',
      header: '目标',
      cell: (row) =>
        row.targetType ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.targetType}
            {row.targetId ? `#${row.targetId.slice(0, 8)}` : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'detail',
      header: '详情',
      cell: (row) =>
        row.detail ? (
          <span className="block max-w-100 truncate font-mono text-[11px] text-muted-foreground" title={JSON.stringify(row.detail)}>
            {JSON.stringify(row.detail)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (row) => <span className="font-mono text-[11px] text-muted-foreground">{row.ip ?? '—'}</span>,
    },
  ];

  return (
    <div>
      <PageHeader title="操作审计" description="所有后台写操作都会留痕，用于事后追溯" />
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        refreshing={list.isFetching && !list.isLoading}
        skeletonRows={12}
        emptyText="还没有操作记录"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />
    </div>
  );
}
