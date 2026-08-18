import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HardDrive, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StorageProfile } from '@videox/shared';
import {
  Badge,
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
  Switch,
  cn,
} from '@videox/ui';
import { systemApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { PageHeader } from '../components/Page';
import { useConfirm } from '../components/ConfirmDialog';

const MASK = '••••••••';

interface StorageDraft {
  id?: string;
  name: string;
  driver: 'local' | 's3';
  root: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

const EMPTY: StorageDraft = {
  name: '',
  driver: 's3',
  root: '',
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
  publicBaseUrl: '',
};

function toBody(draft: StorageDraft): Record<string, unknown> {
  const config: Record<string, unknown> =
    draft.driver === 'local'
      ? { root: draft.root.trim() || undefined }
      : {
          endpoint: draft.endpoint.trim(),
          region: draft.region.trim() || 'auto',
          bucket: draft.bucket.trim(),
          accessKeyId: draft.accessKeyId.trim(),
          forcePathStyle: draft.forcePathStyle,
          publicBaseUrl: draft.publicBaseUrl.trim(),
        };
  // 未改动就别回传脱敏串，否则会把真 key 覆盖成一串圆点。
  if (draft.driver === 's3' && draft.secretAccessKey && draft.secretAccessKey !== MASK) {
    config.secretAccessKey = draft.secretAccessKey;
  }
  return { name: draft.name.trim(), driver: draft.driver, config };
}

export function StoragePage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<StorageDraft | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);

  const list = useQuery({ queryKey: ['storage-profiles'], queryFn: systemApi.storage });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['storage-profiles'] });

  const save = useMutation({
    mutationFn: (input: StorageDraft) =>
      input.id ? systemApi.updateStorage(input.id, toBody(input)) : systemApi.createStorage(toBody(input)),
    onSuccess: async () => {
      toast.success('已保存');
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activate = useMutation({
    mutationFn: (id: string) => systemApi.activateStorage(id),
    onSuccess: async () => {
      toast.success('已切换为当前存储，新上传的文件会写入这里');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => systemApi.deleteStorage(id),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = async (id: string) => {
    setTesting(id);
    try {
      const result = await systemApi.testStorage(id);
      if (result.ok) toast.success(result.message || '连接正常');
      else toast.error(result.message || '连接失败');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const edit = (profile: StorageProfile) =>
    setDraft({
      id: profile.id,
      name: profile.name,
      driver: profile.driver as 'local' | 's3',
      root: profile.config.root ?? '',
      endpoint: profile.config.endpoint ?? '',
      region: profile.config.region ?? 'auto',
      bucket: profile.config.bucket ?? '',
      accessKeyId: profile.config.accessKeyId ?? '',
      secretAccessKey: profile.config.secretAccessKey ?? '',
      forcePathStyle: profile.config.forcePathStyle ?? true,
      publicBaseUrl: profile.config.publicBaseUrl ?? '',
    });

  return (
    <div>
      <PageHeader
        title="存储配置"
        description="本地磁盘与 S3 兼容对象存储可随时切换，已上传的文件仍从原驱动读取"
        actions={
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
            <Plus />
            新建配置
          </Button>
        }
      />

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="h-44 animate-pulse rounded-xl bg-muted" />
          <div className="h-44 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(list.data ?? []).map((profile) => (
            <div
              key={profile.id}
              className={cn(
                'rounded-xl border bg-card p-4',
                profile.isActive ? 'border-foreground' : 'border-border',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <HardDrive className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {profile.name}
                      {profile.isActive ? (
                        <Badge>
                          <CheckCircle2 />
                          使用中
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {profile.driver === 'local' ? `本地磁盘 · ${profile.config.root || '默认目录'}` : `S3 兼容 · ${profile.config.bucket || '未设置 bucket'}`}
                    </p>
                  </div>
                </div>
              </div>

              {profile.driver === 's3' ? (
                <dl className="mt-3 space-y-1 text-[11px]">
                  <Row label="Endpoint" value={profile.config.endpoint || '—'} />
                  <Row label="Region" value={profile.config.region || '—'} />
                  <Row label="CDN 域名" value={profile.config.publicBaseUrl || '未配置，回源直出'} />
                </dl>
              ) : (
                <dl className="mt-3 space-y-1 text-[11px]">
                  <Row label="根目录" value={profile.config.root || '沿用 .env 默认值'} />
                </dl>
              )}

              <p className="mt-2 text-[11px] text-muted-foreground">创建于 {formatDateTime(profile.createdAt)}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                {!profile.isActive ? (
                  <Button size="sm" disabled={activate.isPending} onClick={() => activate.mutate(profile.id)}>
                    设为当前
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" disabled={testing === profile.id} onClick={() => void test(profile.id)}>
                  <Plug />
                  {testing === profile.id ? '测试中…' : '测试连接'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => edit(profile)}>
                  <Pencil />
                  编辑
                </Button>
                {!profile.isActive ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    title="删除"
                    onClick={async () => {
                      const ok = await confirm({
                        title: '删除该存储配置？',
                        description: '已存储的文件不会被删除，但这条配置将不可用。',
                        confirmText: '删除',
                        destructive: true,
                      });
                      if (ok) remove.mutate(profile.id);
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-120">
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑存储配置' : '新建存储配置'}</DialogTitle>
            <DialogDescription>保存后建议先「测试连接」，确认可读写再设为当前存储。</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="scrollbar-thin max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="配置名">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Cloudflare R2" />
                </Field>
                <Field label="驱动">
                  <Select value={draft.driver} onValueChange={(value) => setDraft({ ...draft, driver: value as 'local' | 's3' })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">本地磁盘</SelectItem>
                      <SelectItem value="s3">S3 兼容（MinIO / R2 / OSS）</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {draft.driver === 'local' ? (
                <Field label="根目录" hint="留空则沿用 .env 里的 STORAGE_LOCAL_ROOT">
                  <Input value={draft.root} onChange={(e) => setDraft({ ...draft, root: e.target.value })} placeholder="D:/videox-data" />
                </Field>
              ) : (
                <>
                  <Field label="Endpoint" hint="R2 形如 https://<account>.r2.cloudflarestorage.com">
                    <Input value={draft.endpoint} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} />
                  </Field>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label="Bucket">
                      <Input value={draft.bucket} onChange={(e) => setDraft({ ...draft, bucket: e.target.value })} />
                    </Field>
                    <Field label="Region" hint="R2 填 auto">
                      <Input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} />
                    </Field>
                    <Field label="Access Key ID">
                      <Input value={draft.accessKeyId} onChange={(e) => setDraft({ ...draft, accessKeyId: e.target.value })} />
                    </Field>
                    <Field label="Secret Access Key" hint={draft.id ? '留空表示不修改' : undefined}>
                      <Input
                        type="password"
                        value={draft.secretAccessKey}
                        onChange={(e) => setDraft({ ...draft, secretAccessKey: e.target.value })}
                        placeholder={draft.id ? MASK : ''}
                      />
                    </Field>
                  </div>
                  <Field label="CDN 公网域名" hint="配置后媒体地址直接指向 CDN，回源压力更小">
                    <Input
                      value={draft.publicBaseUrl}
                      onChange={(e) => setDraft({ ...draft, publicBaseUrl: e.target.value })}
                      placeholder="https://cdn.example.com"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={draft.forcePathStyle}
                      onCheckedChange={(checked) => setDraft({ ...draft, forcePathStyle: checked })}
                    />
                    Path Style 寻址（MinIO 必开）
                  </label>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button disabled={save.isPending || !draft?.name.trim()} onClick={() => draft && save.mutate(draft)}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
    </div>
  );
}
