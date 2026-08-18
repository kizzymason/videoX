import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Category } from '@videox/shared';
import {
  Button,
  Dialog,
  DialogContent,
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
  Switch,
  Textarea,
} from '@videox/ui';
import { catalogApi } from '../lib/api';
import { formatNumber } from '../lib/format';
import { PageHeader } from '../components/Page';
import { DataTable, type Column } from '../components/DataTable';
import { useConfirm } from '../components/ConfirmDialog';

const NO_PARENT = '__root__';

interface CategoryDraft {
  id?: string;
  slug: string;
  name: string;
  description: string;
  coverUrl: string;
  icon: string;
  parentId: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY: CategoryDraft = {
  slug: '',
  name: '',
  description: '',
  coverUrl: '',
  icon: '',
  parentId: NO_PARENT,
  sortOrder: 0,
  isActive: true,
};

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<CategoryDraft | null>(null);

  const list = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories'] });

  const save = useMutation({
    mutationFn: (input: CategoryDraft) => {
      const body = {
        slug: input.slug.trim(),
        name: input.name.trim(),
        description: input.description.trim() || null,
        coverUrl: input.coverUrl.trim() || null,
        icon: input.icon.trim() || null,
        parentId: input.parentId === NO_PARENT ? null : input.parentId,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      };
      return input.id ? catalogApi.updateCategory(input.id, body) : catalogApi.createCategory(body);
    },
    onSuccess: async () => {
      toast.success('已保存');
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteCategory(id),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => catalogApi.updateCategory(id, { isActive }),
    onSuccess: () => void invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const categories = list.data ?? [];
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const columns: Column<Category>[] = [
    {
      key: 'sort',
      header: '排序',
      headClassName: 'w-16',
      cell: (row) => (
        <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
          <GripVertical className="size-3.5 opacity-40" />
          {row.sortOrder}
        </span>
      ),
    },
    {
      key: 'name',
      header: '名称',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.icon ? <span className="mr-1.5">{row.icon}</span> : null}
            {row.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">/{row.slug}</p>
        </div>
      ),
    },
    {
      key: 'parent',
      header: '上级',
      cell: (row) => <span className="text-muted-foreground">{row.parentId ? nameById.get(row.parentId) ?? '—' : '—'}</span>,
    },
    {
      key: 'count',
      header: '视频数',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatNumber(row.videoCount ?? 0)}</span>,
    },
    {
      key: 'active',
      header: '启用',
      cell: (row) => (
        <Switch checked={row.isActive} onCheckedChange={(checked) => toggle.mutate({ id: row.id, isActive: checked })} />
      ),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-20',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            title="编辑"
            onClick={() =>
              setDraft({
                id: row.id,
                slug: row.slug,
                name: row.name,
                description: row.description ?? '',
                coverUrl: row.coverUrl ?? '',
                icon: row.icon ?? '',
                parentId: row.parentId ?? NO_PARENT,
                sortOrder: row.sortOrder,
                isActive: row.isActive,
              })
            }
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="删除"
            onClick={async () => {
              const ok = await confirm({
                title: '删除该分类？',
                description: `“${row.name}” 下的视频会变为未分类。`,
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
        title="频道分类"
        description="前台侧边栏与分类页的数据来源"
        actions={
          <Button size="sm" onClick={() => setDraft({ ...EMPTY, sortOrder: categories.length })}>
            <Plus />
            新建分类
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={categories}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        emptyText="还没有分类，先建一个"
      />

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-120">
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑分类' : '新建分类'}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3.5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="名称">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label="Slug" hint="用于前台 URL，仅小写字母数字与连字符">
                  <Input
                    value={draft.slug}
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                    placeholder="anime"
                  />
                </Field>
              </div>
              <Field label="简介">
                <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="上级分类">
                  <Select value={draft.parentId} onValueChange={(value) => setDraft({ ...draft, parentId: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>顶级分类</SelectItem>
                      {categories
                        .filter((c) => c.id !== draft.id)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="排序值" hint="数字越小越靠前">
                  <Input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                  />
                </Field>
                <Field label="图标" hint="emoji 或图标名">
                  <Input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
                </Field>
                <Field label="封面 URL">
                  <Input value={draft.coverUrl} onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })} />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="cat-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
                <label htmlFor="cat-active" className="text-sm">
                  在前台展示
                </label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              disabled={save.isPending || !draft?.name.trim() || !draft?.slug.trim()}
              onClick={() => draft && save.mutate(draft)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </div>
  );
}

export function TagsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = React.useState(1);

  const list = useQuery({ queryKey: ['admin-tags', page], queryFn: () => catalogApi.tags(page, 60) });

  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteTag(id),
    onSuccess: async () => {
      toast.success('标签已删除');
      await queryClient.invalidateQueries({ queryKey: ['admin-tags'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tags = list.data?.items ?? [];
  const meta = list.data?.meta;

  return (
    <div>
      <PageHeader
        title="标签"
        description="标签由上传时自动创建，这里只做清理。删除标签不会影响视频本身。"
      />

      {list.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="h-7 w-20 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          还没有标签
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="group flex items-center gap-1.5 rounded-full border border-border py-1 pr-1.5 pl-3 text-xs"
              >
                {tag.name}
                <span className="text-muted-foreground tabular-nums">{formatNumber(tag.videoCount ?? 0)}</span>
                <button
                  type="button"
                  aria-label={`删除 ${tag.name}`}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `删除标签「${tag.name}」？`,
                      description: '已关联的视频会移除该标签。',
                      confirmText: '删除',
                      destructive: true,
                    });
                    if (ok) remove.mutate(tag.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {meta && meta.totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            共 {formatNumber(meta.total)} 个标签 · 第 {meta.page} / {meta.totalPages} 页
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>
              上一页
            </Button>
            <Button variant="outline" size="sm" disabled={!meta.hasMore} onClick={() => setPage(meta.page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      ) : null}

      {dialog}
    </div>
  );
}
