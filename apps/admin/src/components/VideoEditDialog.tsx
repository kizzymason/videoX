import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Category, VideoSummary } from '@videox/shared';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@videox/ui';
import { videosApi } from '../lib/api';
import { TagInput } from './TagInput';

interface Draft {
  title: string;
  description: string;
  categoryId: string;
  tags: string[];
  accessLevel: string;
  visibility: string;
  posterUrl: string;
  verticalPosterUrl: string;
}

const NO_CATEGORY = '__none__';

function toDraft(video: VideoSummary): Draft {
  return {
    title: video.title,
    description: video.description ?? '',
    categoryId: video.category?.id ?? NO_CATEGORY,
    tags: video.tags.map((t) => t.name),
    accessLevel: video.accessLevel,
    visibility: video.visibility,
    posterUrl: video.posterUrl ?? '',
    verticalPosterUrl: video.verticalPosterUrl ?? '',
  };
}

export function VideoEditDialog({
  video,
  categories,
  onClose,
  onSaved,
}: {
  video: VideoSummary | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    setDraft(video ? toDraft(video) : null);
  }, [video]);

  const save = useMutation({
    mutationFn: () =>
      videosApi.update(video!.id, {
        title: draft!.title,
        description: draft!.description || null,
        categoryId: draft!.categoryId === NO_CATEGORY ? null : draft!.categoryId,
        tags: draft!.tags,
        accessLevel: draft!.accessLevel,
        visibility: draft!.visibility,
        posterUrl: draft!.posterUrl || null,
        verticalPosterUrl: draft!.verticalPosterUrl || null,
      }),
    onSuccess: () => {
      toast.success('已保存');
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = (part: Partial<Draft>) => setDraft((prev) => (prev ? { ...prev, ...part } : prev));

  return (
    <Dialog open={video !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-140">
        <DialogHeader>
          <DialogTitle>编辑视频</DialogTitle>
          <DialogDescription className="truncate">{video?.slug}</DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="scrollbar-thin max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
            <Field label="标题">
              <Input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <Field label="简介">
              <Textarea
                rows={4}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="用于播放页展示与 SEO description"
              />
            </Field>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="分类">
                <Select value={draft.categoryId} onValueChange={(value) => patch({ categoryId: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>不设分类</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="访问权限" hint="会员专享会自动启用 AES-128 加密与预览门禁">
                <Select value={draft.accessLevel} onValueChange={(value) => patch({ accessLevel: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">免费</SelectItem>
                    <SelectItem value="login">登录可见</SelectItem>
                    <SelectItem value="vip">会员专享</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="可见性">
                <Select value={draft.visibility} onValueChange={(value) => patch({ visibility: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">公开</SelectItem>
                    <SelectItem value="unlisted">不公开（仅链接可达）</SelectItem>
                    <SelectItem value="private">私密</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="标签" hint="回车或逗号分隔，用于推荐召回与搜索">
              <TagInput value={draft.tags} onChange={(tags) => patch({ tags })} />
            </Field>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="横版封面 URL">
                <Input value={draft.posterUrl} onChange={(e) => patch({ posterUrl: e.target.value })} placeholder="留空用转码自动截图" />
              </Field>
              <Field label="竖版封面 URL" hint="移动端瀑布流优先使用">
                <Input
                  value={draft.verticalPosterUrl}
                  onChange={(e) => patch({ verticalPosterUrl: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending || !draft?.title.trim()} onClick={() => save.mutate()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
