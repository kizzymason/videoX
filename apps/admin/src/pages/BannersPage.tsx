import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Banner } from '@videox/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Switch,
} from '@videox/ui';
import { catalogApi } from '../lib/api';
import { formatDate } from '../lib/format';
import { PageHeader } from '../components/Page';
import { useConfirm } from '../components/ConfirmDialog';

interface BannerDraft {
  id?: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  mobileImageUrl: string;
  linkUrl: string;
  videoId: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

const EMPTY: BannerDraft = {
  title: '',
  subtitle: '',
  imageUrl: '',
  mobileImageUrl: '',
  linkUrl: '',
  videoId: '',
  sortOrder: 0,
  isActive: true,
  startsAt: '',
  endsAt: '',
};

/** datetime-local 需要 `YYYY-MM-DDTHH:mm`，直接塞 ISO 串控件会置空。 */
function toLocalInput(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BannersPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<BannerDraft | null>(null);

  const list = useQuery({ queryKey: ['admin-banners'], queryFn: catalogApi.banners });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-banners'] });

  const save = useMutation({
    mutationFn: (input: BannerDraft) => {
      const body = {
        title: input.title.trim(),
        subtitle: input.subtitle.trim() || null,
        imageUrl: input.imageUrl.trim(),
        mobileImageUrl: input.mobileImageUrl.trim() || null,
        linkUrl: input.linkUrl.trim() || null,
        videoId: input.videoId.trim() || null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        startsAt: input.startsAt ? new Date(input.startsAt).toISOString() : null,
        endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : null,
      };
      return input.id ? catalogApi.updateBanner(input.id, body) : catalogApi.createBanner(body);
    },
    onSuccess: async () => {
      toast.success('已保存');
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteBanner(id),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => catalogApi.updateBanner(id, { isActive }),
    onSuccess: () => void invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const banners = [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const edit = (banner: Banner) =>
    setDraft({
      id: banner.id,
      title: banner.title,
      subtitle: banner.subtitle ?? '',
      imageUrl: banner.imageUrl,
      mobileImageUrl: banner.mobileImageUrl ?? '',
      linkUrl: banner.linkUrl ?? '',
      videoId: banner.videoId ?? '',
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
      startsAt: toLocalInput(banner.startsAt),
      endsAt: toLocalInput(banner.endsAt),
    });

  return (
    <div>
      <PageHeader
        title="轮播管理"
        description="首页顶部大图，PC 与移动可分别配图"
        actions={
          <Button size="sm" onClick={() => setDraft({ ...EMPTY, sortOrder: banners.length })}>
            <Plus />
            新建轮播
          </Button>
        }
      />

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : banners.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
          <ImageOff className="size-7" strokeWidth={1.5} />
          <p className="text-sm">还没有轮播图</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {banners.map((banner) => (
            <div key={banner.id} className="group overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative aspect-video bg-muted">
                {banner.imageUrl ? (
                  <img src={banner.imageUrl} alt={banner.title} loading="lazy" className="size-full object-cover" />
                ) : null}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <p className="truncate text-sm font-medium text-white">{banner.title}</p>
                  {banner.subtitle ? <p className="truncate text-xs text-white/70">{banner.subtitle}</p> : null}
                </div>
                <span className="absolute top-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white tabular-nums">
                  #{banner.sortOrder}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <Switch
                  checked={banner.isActive}
                  onCheckedChange={(checked) => toggle.mutate({ id: banner.id, isActive: checked })}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {banner.startsAt || banner.endsAt
                    ? `${formatDate(banner.startsAt)} ~ ${formatDate(banner.endsAt)}`
                    : '长期有效'}
                </span>
                <Button variant="ghost" size="icon" title="编辑" onClick={() => edit(banner)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="删除"
                  onClick={async () => {
                    const ok = await confirm({
                      title: '删除该轮播？',
                      description: `“${banner.title}” 会立即从首页移除。`,
                      confirmText: '删除',
                      destructive: true,
                    });
                    if (ok) remove.mutate(banner.id);
                  }}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-125">
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑轮播' : '新建轮播'}</DialogTitle>
            <DialogDescription>图片建议 16:9，移动端图可用 4:3 或竖版以获得更好观感。</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="scrollbar-thin max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
              <Field label="标题">
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="副标题">
                <Input value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              </Field>
              <Field label="PC 图片 URL">
                <Input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
              </Field>
              {draft.imageUrl ? (
                <img src={draft.imageUrl} alt="" className="aspect-video w-full rounded-lg border border-border object-cover" />
              ) : null}
              <Field label="移动端图片 URL" hint="留空则复用 PC 图">
                <Input
                  value={draft.mobileImageUrl}
                  onChange={(e) => setDraft({ ...draft, mobileImageUrl: e.target.value })}
                />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="跳转链接" hint="填了 videoId 时优先跳播放页">
                  <Input value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
                </Field>
                <Field label="关联视频 ID">
                  <Input value={draft.videoId} onChange={(e) => setDraft({ ...draft, videoId: e.target.value })} />
                </Field>
                <Field label="上线时间">
                  <Input
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                  />
                </Field>
                <Field label="下线时间">
                  <Input
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                  />
                </Field>
                <Field label="排序值" hint="数字越小越靠前">
                  <Input
                    type="number"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="banner-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
                <label htmlFor="banner-active" className="text-sm">
                  立即启用
                </label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              disabled={save.isPending || !draft?.title.trim() || !draft?.imageUrl.trim()}
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
