import type * as React from 'react';
import type { PageMeta } from '@videox/shared';
import { Button, Skeleton, Spinner, cn } from '@videox/ui';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** 单元格内容；不传则回退到 row[key] */
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** 后台分页时的静默刷新，只在表头压一条细进度线，不整表闪骨架 */
  refreshing?: boolean;
  emptyText?: string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  /** 骨架行数，尽量贴近实际 pageSize 避免高度跳动 */
  skeletonRows?: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  refreshing,
  emptyText = '暂无数据',
  selectable,
  selected,
  onSelectedChange,
  onRowClick,
  skeletonRows = 8,
}: DataTableProps<T>) {
  const ids = rows.map(rowKey);
  const allSelected = selectable && ids.length > 0 && ids.every((id) => selected?.has(id));
  const someSelected = selectable && ids.some((id) => selected?.has(id)) && !allSelected;

  const toggleAll = () => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectedChange(next);
  };

  const toggleOne = (id: string) => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {refreshing ? (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-loading-slide bg-foreground/40" />
        </div>
      ) : null}
      <div className="scrollbar-thin overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              {selectable ? (
                <th className="w-9 pr-0">
                  <input
                    type="checkbox"
                    aria-label="全选本页"
                    className="size-3.5 accent-foreground align-middle"
                    checked={Boolean(allSelected)}
                    ref={(el) => {
                      if (el) el.indeterminate = Boolean(someSelected);
                    }}
                    onChange={toggleAll}
                  />
                </th>
              ) : null}
              {columns.map((col) => (
                <th key={col.key} className={col.headClassName}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i}>
                    {selectable ? <td /> : null}
                    {columns.map((col) => (
                      <td key={col.key}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, index) => {
                  const id = rowKey(row);
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        onRowClick && 'cursor-pointer',
                        selected?.has(id) && 'bg-accent/60 hover:bg-accent/60',
                      )}
                    >
                      {selectable ? (
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="选择该行"
                            className="size-3.5 accent-foreground align-middle"
                            checked={selected?.has(id) ?? false}
                            onChange={() => toggleOne(id)}
                          />
                        </td>
                      ) : null}
                      {columns.map((col) => (
                        <td key={col.key} className={col.className}>
                          {col.cell(row, index)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
          <Inbox className="size-7" strokeWidth={1.5} />
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : null}
    </div>
  );
}

export function Pagination({
  meta,
  onChange,
  busy,
}: {
  meta: PageMeta | undefined;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (!meta || meta.total === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        共 {meta.total.toLocaleString('zh-CN')} 条 · 第 {meta.page} / {Math.max(1, meta.totalPages)} 页
      </span>
      <div className="flex items-center gap-1.5">
        {busy ? <Spinner className="size-3.5" /> : null}
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onChange(meta.page - 1)}>
          <ChevronLeft />
          上一页
        </Button>
        <Button variant="outline" size="sm" disabled={!meta.hasMore} onClick={() => onChange(meta.page + 1)}>
          下一页
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
