import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Radio, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { TranscodeJob } from '@videox/shared';
import { Button, Progress, cn } from '@videox/ui';
import { videosApi } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { PageHeader, SectionTitle } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { ACTIVE_JOB_STATUSES, StatusBadge } from '../components/StatusBadge';
import { useTranscodeStream } from '../hooks/use-transcode-stream';

const STAGE_LABELS: Record<string, string> = {
  probing: '探测源文件',
  assets: '生成封面与雪碧图',
  ladder: '规划码率阶梯',
  transcoding: '转码',
  packaging: '打包 HLS',
  uploading: '上传产物',
  finalizing: '收尾',
};

export function TranscodePage() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const { jobs: live, connected } = useTranscodeStream();

  const history = useQuery({
    queryKey: ['transcode-jobs', page],
    queryFn: () => videosApi.jobs(page, 20),
    placeholderData: keepPreviousData,
  });

  // 在途任务跑完会从 SSE 列表消失，这时刷新历史表才看得到结果。
  const liveCount = live.length;
  React.useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['transcode-jobs'] });
  }, [liveCount, queryClient]);

  const cancel = useMutation({
    mutationFn: (id: string) => videosApi.cancelJob(id),
    onSuccess: async () => {
      toast.success('已请求取消，worker 会在当前分段结束后停止');
      await queryClient.invalidateQueries({ queryKey: ['transcode-jobs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<TranscodeJob>[] = [
    {
      key: 'video',
      header: '视频',
      cell: (row) => <span className="block max-w-70 truncate font-medium">{row.videoTitle || row.videoId}</span>,
    },
    { key: 'status', header: '状态', cell: (row) => <StatusBadge status={row.status} kind="job" /> },
    {
      key: 'progress',
      header: '进度',
      headClassName: 'w-36',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Progress value={row.progress} className="h-1.5 w-20" />
          <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(row.progress)}%</span>
        </div>
      ),
    },
    {
      key: 'renditions',
      header: '已完成档位',
      cell: (row) =>
        row.completedRenditions.length > 0 ? (
          <span className="text-muted-foreground">{row.completedRenditions.join(' / ')}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'attempts',
      header: '重试',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{row.attempts}</span>,
    },
    {
      key: 'time',
      header: '开始 / 结束',
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(row.startedAt)}
          <br />
          {formatDateTime(row.finishedAt)}
        </span>
      ),
    },
    {
      key: 'error',
      header: '错误',
      cell: (row) =>
        row.errorMessage ? (
          <span className="block max-w-50 truncate text-destructive" title={row.errorMessage}>
            {row.errorMessage}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      headClassName: 'w-24',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          {ACTIVE_JOB_STATUSES.includes(row.status) ? (
            <Button variant="ghost" size="icon" title="取消" onClick={() => cancel.mutate(row.id)}>
              <Ban className="size-3.5" />
            </Button>
          ) : null}
          {row.status === 'failed' || row.status === 'canceled' ? (
            <Button
              variant="ghost"
              size="icon"
              title="重新转码"
              onClick={async () => {
                try {
                  await videosApi.retranscode(row.videoId);
                  toast.success('已重新入队');
                  await queryClient.invalidateQueries({ queryKey: ['transcode-jobs'] });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="转码队列"
        description="worker 实时进度通过 SSE 推送，2 秒一帧"
        actions={
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              connected ? 'border-emerald-500/25 text-emerald-600 dark:text-emerald-400' : 'border-border text-muted-foreground',
            )}
          >
            <Radio className={cn('size-3.5', connected && 'animate-pulse')} />
            {connected ? '实时连接中' : '连接中断，重连中'}
          </span>
        }
      />

      <section className="mb-6">
        <SectionTitle>在途任务（{live.length}）</SectionTitle>
        {live.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            当前没有正在转码的任务
          </div>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {live.map((job) => (
              <div key={job.id} className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{job.videoTitle || job.videoId}</p>
                  <StatusBadge status={job.status} kind="job" />
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {STAGE_LABELS[job.stage ?? ''] ?? job.stage ?? '准备中'}
                  {job.currentRendition ? ` · ${job.currentRendition}` : ''}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <Progress value={job.progress} className="h-1.5 flex-1" />
                  <span className="text-xs font-medium tabular-nums">{Math.round(job.progress)}%</span>
                </div>
                {job.completedRenditions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {job.completedRenditions.map((name) => (
                      <span key={name} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {job.errorMessage ? <p className="mt-2 text-[11px] text-destructive">{job.errorMessage}</p> : null}
                <div className="mt-2.5 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => cancel.mutate(job.id)}>
                    <Ban className="size-3.5" />
                    取消
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <SectionTitle>历史任务</SectionTitle>
      <DataTable
        columns={columns}
        rows={history.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={history.isLoading}
        refreshing={history.isFetching && !history.isLoading}
        emptyText="还没有转码记录"
      />
      <Pagination meta={history.data?.meta} onChange={setPage} busy={history.isFetching} />
    </div>
  );
}
