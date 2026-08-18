import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Order } from '@videox/shared';
import { Badge, Input, useDebouncedValue } from '@videox/ui';
import { membershipApi } from '../lib/api';
import { formatCents, formatDateTime } from '../lib/format';
import { FilterBar, PageHeader } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { FilterSelect } from './VideosPage';

const PAGE_SIZE = 20;

const SOURCE_LABEL: Record<string, string> = {
  redeem: '卡密兑换',
  admin_grant: '后台赠送',
  purchase: '在线购买',
  gift: '赠礼',
};

export function OrdersPage() {
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('all');

  const debouncedQ = useDebouncedValue(q.trim(), 300);
  React.useEffect(() => setPage(1), [debouncedQ, status]);

  const list = useQuery({
    queryKey: ['admin-orders', { page, debouncedQ, status }],
    queryFn: () =>
      membershipApi.orders({
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  const pageRevenue = (list.data?.items ?? [])
    .filter((order) => order.status === 'paid')
    .reduce((sum, order) => sum + order.amountCents, 0);

  const columns: Column<Order>[] = [
    { key: 'orderNo', header: '订单号', cell: (row) => <span className="font-mono text-xs">{row.orderNo}</span> },
    { key: 'user', header: '用户', cell: (row) => <span>@{row.username}</span> },
    { key: 'plan', header: '套餐', cell: (row) => <span className="text-muted-foreground">{row.planName ?? '—'}</span> },
    {
      key: 'amount',
      header: '金额',
      cell: (row) => <span className="font-medium tabular-nums">{formatCents(row.amountCents)}</span>,
    },
    {
      key: 'source',
      header: '来源',
      cell: (row) => (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {SOURCE_LABEL[row.source] ?? row.source}
        </Badge>
      ),
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'createdAt',
      header: '时间',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="订单流水"
        description="卡密兑换与后台赠送都会落一条流水，便于对账"
        actions={
          <span className="text-xs text-muted-foreground">
            本页已支付合计 <span className="font-medium text-foreground tabular-nums">{formatCents(pageRevenue)}</span>
          </span>
        }
      />

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索订单号" className="h-8 pl-8 text-xs" />
        </div>
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'paid', label: '已支付' },
            { value: 'pending', label: '待支付' },
            { value: 'refunded', label: '已退款' },
            { value: 'canceled', label: '已取消' },
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
        emptyText="还没有订单"
      />
      <Pagination meta={list.data?.meta} onChange={setPage} busy={list.isFetching} />
    </div>
  );
}
