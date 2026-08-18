import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, CloudUpload, FileVideo, Trash2, TriangleAlert, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Field,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@videox/ui';
import { catalogApi } from '../lib/api';
import { formatBytes } from '../lib/format';
import {
  CHUNK_SIZE,
  formatEta,
  formatSpeed,
  runUpload,
  stripExtension,
  type UploadMeta,
  type UploadTask,
} from '../lib/uploader';
import { PageHeader } from '../components/Page';
import { TagInput } from '../components/TagInput';

const ACCEPT = 'video/*,.mp4,.mkv,.mov,.avi,.flv,.webm,.ts,.m4v';
/** 同时跑几个文件。转码在后端排队，这里只管上传带宽。 */
const FILE_CONCURRENCY = 2;

const PHASE_LABEL: Record<UploadTask['phase'], string> = {
  queued: '等待中',
  hashing: '计算指纹',
  uploading: '上传中',
  processing: '服务端合并',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
};

export function UploadPage() {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories, staleTime: 5 * 60_000 });

  const [tasks, setTasks] = React.useState<UploadTask[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [meta, setMeta] = React.useState<UploadMeta & { title: string; description: string; tags: string[] }>({
    title: '',
    description: '',
    categoryId: '',
    tags: [],
    accessLevel: 'free',
    visibility: 'public',
  });

  const controllers = React.useRef(new Map<string, AbortController>());
  const inputRef = React.useRef<HTMLInputElement>(null);

  const update = React.useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const incoming = [...files].filter((file) => file.size > 0);
    if (incoming.length === 0) return;
    setTasks((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        phase: 'queued' as const,
        progress: 0,
        uploadId: null,
        videoId: null,
        jobId: null,
        instant: false,
        error: null,
        bytesPerSecond: 0,
      })),
    ]);
  };

  /** 队列消费：始终保持 FILE_CONCURRENCY 个文件在跑，一个结束立刻补位。 */
  const start = async () => {
    if (running) return;
    setRunning(true);
    try {
      let cursor = 0;
      const queue = tasks.filter((task) => task.phase === 'queued' || task.phase === 'error');
      if (queue.length === 0) {
        toast.info('没有待上传的文件');
        return;
      }
      const worker = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const task = queue[index]!;
          const controller = new AbortController();
          controllers.current.set(task.id, controller);
          await runUpload(
            { ...task, phase: 'queued', error: null },
            {
              // 多文件时标题各自取文件名，单文件才用手填的标题。
              title: queue.length === 1 && meta.title.trim() ? meta.title.trim() : stripExtension(task.file.name),
              description: meta.description.trim() || undefined,
              categoryId: meta.categoryId || undefined,
              tags: meta.tags,
              accessLevel: meta.accessLevel,
              visibility: meta.visibility,
            },
            (patch) => update(task.id, patch),
            controller.signal,
          );
          controllers.current.delete(task.id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, queue.length) }, worker));
      await queryClient.invalidateQueries();
      toast.success('上传队列已处理完毕');
    } finally {
      setRunning(false);
    }
  };

  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
  };

  const removeTask = (id: string) => {
    cancel(id);
    setTasks((prev) => prev.filter((task) => task.id !== id));
  };

  const pendingCount = tasks.filter((t) => t.phase === 'queued' || t.phase === 'error').length;
  const doneCount = tasks.filter((t) => t.phase === 'done').length;
  const totalBytes = tasks.reduce((sum, t) => sum + t.file.size, 0);

  return (
    <div>
      <PageHeader
        title="视频上传"
        description={`分片大小 ${formatBytes(CHUNK_SIZE)}，支持断点续传与秒传`}
        actions={
          <>
            {tasks.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={running}
                onClick={() => {
                  tasks.forEach((task) => cancel(task.id));
                  setTasks([]);
                }}
              >
                清空列表
              </Button>
            ) : null}
            <Button size="sm" disabled={running || pendingCount === 0} onClick={() => void start()}>
              <CloudUpload />
              {running ? '上传中…' : `开始上传${pendingCount ? ` (${pendingCount})` : ''}`}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-12 transition-colors',
              dragging ? 'border-foreground bg-accent' : 'border-border hover:border-foreground/30 hover:bg-accent/40',
            )}
          >
            <CloudUpload className="size-7 text-muted-foreground" strokeWidth={1.6} />
            <p className="text-sm font-medium">拖拽视频到此处，或点击选择文件</p>
            <p className="text-xs text-muted-foreground">支持批量选择，单文件无大小限制</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {tasks.length > 0 ? (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {tasks.length} 个文件 · 共 {formatBytes(totalBytes)}
                </span>
                <span className="tabular-nums">已完成 {doneCount}</span>
              </div>
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} onCancel={() => cancel(task.id)} onRemove={() => removeTask(task.id)} />
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <aside className="h-fit space-y-3.5 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">默认元数据</h3>
          <p className="-mt-2 text-xs text-muted-foreground">批量上传时标题取文件名，其余字段共用以下设置。</p>

          <Field label="标题" hint="仅单文件上传时生效">
            <Input
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              placeholder="留空则用文件名"
            />
          </Field>
          <Field label="简介">
            <Textarea
              rows={3}
              value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            />
          </Field>
          <Field label="分类">
            <Select value={meta.categoryId || 'none'} onValueChange={(v) => setMeta({ ...meta, categoryId: v === 'none' ? '' : v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不设分类</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="标签">
            <TagInput value={meta.tags} onChange={(tags) => setMeta({ ...meta, tags })} />
          </Field>
          <Field label="访问权限" hint="会员专享会启用 AES-128 加密">
            <Select value={meta.accessLevel} onValueChange={(v) => setMeta({ ...meta, accessLevel: v })}>
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
            <Select value={meta.visibility} onValueChange={(v) => setMeta({ ...meta, visibility: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">公开</SelectItem>
                <SelectItem value="unlisted">不公开</SelectItem>
                <SelectItem value="private">私密</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link to="/transcode">查看转码进度</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

function TaskRow({ task, onCancel, onRemove }: { task: UploadTask; onCancel: () => void; onRemove: () => void }) {
  const active = task.phase === 'hashing' || task.phase === 'uploading' || task.phase === 'processing';
  const remaining = task.file.size * (1 - task.progress / 100);

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          {task.phase === 'done' ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : task.phase === 'error' ? (
            <TriangleAlert className="size-4 text-destructive" />
          ) : (
            <FileVideo className="size-4 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.file.name}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatBytes(task.file.size)}</span>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <Progress
              value={task.progress}
              className={cn('h-1.5 flex-1', task.phase === 'error' && '[&>div]:bg-destructive')}
            />
            <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {Math.round(task.progress)}%
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>{PHASE_LABEL[task.phase]}</span>
            {task.instant ? (
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                <Zap className="size-3" />
                秒传命中
              </span>
            ) : null}
            {task.phase === 'uploading' && task.bytesPerSecond > 0 ? (
              <>
                <span>{formatSpeed(task.bytesPerSecond)}</span>
                <span>{formatEta(remaining, task.bytesPerSecond)}</span>
              </>
            ) : null}
            {task.error ? <span className="text-destructive">{task.error}</span> : null}
            {task.videoId ? (
              <Link to="/videos" className="underline underline-offset-2 hover:text-foreground">
                去视频管理查看
              </Link>
            ) : null}
          </div>
        </div>

        <div className="shrink-0">
          {active ? (
            <Button variant="ghost" size="icon" title="取消" onClick={onCancel}>
              <X className="size-3.5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" title="移除" onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
