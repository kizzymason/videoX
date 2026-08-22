// ========================================================================
// 采集系统 - 采集任务管理页（任务列表 / 创建 / 重试 / 日志查看器）
// ========================================================================

import * as React from 'react';
import { Activity, Copy, Loader2, Plus, RefreshCw, RotateCcw, ScrollText, Trash2 } from 'lucide-react';
import type { PageMeta } from '@videox/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@videox/ui';
import { DataTable, Pagination, type Column } from '@/components/DataTable';
import { FilterBar, PageHeader } from '@/components/Page';
import { collectionApi, type CollectionJobRow, type CollectionLogRow } from '@/lib/api';

const STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
};

const TYPE_TEXT: Record<string, string> = {
  list_crawl: '列表爬取',
  detail_fetch: '详情获取',
  play_url_refresh: '播放刷新',
  r2_transfer: 'R2 转存',
};

const LEVEL_TEXT: Record<string, string> = { info: 'INFO', warn: '警告', error: '错误' };

const RANGE_OPTIONS: Record<string, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 24 * 7,
};

type TaskType = 'list_crawl' | 'detail_fetch' | 'play_url_refresh';

export function CollectionTasksPage() {
  // 任务列表
  const [jobs, setJobs] = React.useState<CollectionJobRow[]>([]);
  const [meta, setMeta] = React.useState<PageMeta | null>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState('all');
  const [type, setType] = React.useState('all');

  // 队列实时状态
  const [queueStats, setQueueStats] = React.useState<{
    waiting: number;
    active: number;
    failed: number;
    dbFailed?: number;
  } | null>(null);
  const [actionBusy, setActionBusy] = React.useState<string | null>(null);
  const [actionResult, setActionResult] = React.useState<string | null>(null);

  // 创建任务弹窗
  const [createOpen, setCreateOpen] = React.useState(false);
  const [formType, setFormType] = React.useState<TaskType>('list_crawl');
  const [formKind, setFormKind] = React.useState<'gv' | 'mv' | 'tv'>('gv');
  const [formPage, setFormPage] = React.useState('1');
  const [formExternalId, setFormExternalId] = React.useState('');
  const [formPriority, setFormPriority] = React.useState('100');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // 日志查看器
  const [logs, setLogs] = React.useState<CollectionLogRow[]>([]);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const [logLevel, setLogLevel] = React.useState('all');
  const [logJobId, setLogJobId] = React.useState('');
  const [logRange, setLogRange] = React.useState('24h');

  const pageSize = 20;

  const fetchJobs = React.useCallback(async () => {
    setLoading(true);
    try {
      const [result, q] = await Promise.all([
        collectionApi.tasks({
          page,
          pageSize,
          ...(status !== 'all' && { status }),
          ...(type !== 'all' && { type }),
        }),
        collectionApi.queueStats(),
      ]);
      setJobs(result.items);
      setMeta(result.meta);
      setQueueStats(q);
    } catch (error) {
      console.error('获取任务列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  React.useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // 15 秒轮询，实现准实时任务监控（后端暂无 WebSocket/SSE 通道）
  React.useEffect(() => {
    const timer = setInterval(() => void fetchJobs(), 15_000);
    return () => clearInterval(timer);
  }, [fetchJobs]);

  const fetchLogs = React.useCallback(async () => {
    setLogsLoading(true);
    try {
      const hours = RANGE_OPTIONS[logRange];
      const since = hours ? new Date(Date.now() - hours * 3600_000).toISOString() : undefined;
      const result = await collectionApi.logs({
        page: 1,
        pageSize: 50,
        ...(logLevel !== 'all' && { level: logLevel }),
        ...(logJobId && { jobId: logJobId }),
        ...(since && { since }),
      });
      setLogs(result.items);
    } catch (error) {
      console.error('获取采集日志失败:', error);
    } finally {
      setLogsLoading(false);
    }
  }, [logLevel, logJobId, logRange]);

  React.useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  async function handleCreate() {
    const externalId = Number(formExternalId);
    if (formType !== 'list_crawl' && (!formExternalId || Number.isNaN(externalId))) {
      setCreateError('请填写有效的外部视频 ID（数字）');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await collectionApi.createTask({
        type: formType,
        kind: formKind,
        page: Math.max(1, Number(formPage) || 1),
        ...(formType !== 'list_crawl' && { externalId }),
        priority: Math.min(1000, Math.max(0, Number(formPriority) || 100)),
      });
      setCreateOpen(false);
      setFormExternalId('');
      await fetchJobs();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleRetry(id: string) {
    try {
      await collectionApi.retryTask(id);
      await fetchJobs();
    } catch (error) {
      console.error('重试任务失败:', error);
    }
  }

  const failedTotal = queueStats?.dbFailed ?? jobs.filter((j) => j.status === 'failed').length;

  async function runAction(key: string, fn: () => Promise<string>) {
    setActionBusy(key);
    setActionResult(null);
    try {
      const message = await fn();
      setActionResult(message);
      await fetchJobs();
    } catch (error) {
      setActionResult(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRetryAllFailed() {
    if (failedTotal === 0) return;
    if (!window.confirm(`确定重试全部 ${failedTotal} 条失败任务？不限当前页。`)) return;
    await runAction('retry', async () => {
      const result = await collectionApi.retryFailedTasks();
      return result.retried === 0
        ? '没有失败任务可重试'
        : `已重试 ${result.retried} 条失败任务${result.remaining ? `，仍有 ${result.remaining} 条` : ''}`;
    });
  }

  async function handleClearAllFailed() {
    if (failedTotal === 0) return;
    if (
      !window.confirm(
        `确定清除全部 ${failedTotal} 条失败任务？用于清掉号池空窗留下的历史错误，清除后不可恢复。`,
      )
    ) {
      return;
    }
    await runAction('clear', async () => {
      const result = await collectionApi.clearFailedTasks();
      return result.deleted === 0 ? '没有失败任务可清除' : `已清除 ${result.deleted} 条失败任务`;
    });
  }

  async function handleDedupeVideos() {
    if (
      !window.confirm(
        '检查采集索引和已导入视频的重复项（同一外部 ID 或相同标题），多余的待导入记录会删除，已导入的会归档并隐藏重复视频。继续？',
      )
    ) {
      return;
    }
    await runAction('dedupe', async () => {
      const result = await collectionApi.dedupeVideos();
      const changed = result.removedCollected + result.archivedCollected + result.hiddenVideos;
      return changed === 0
        ? `已检查 ${result.scanned} 条采集记录，没有重复视频`
        : `去重完成：删除 ${result.removedCollected} 条、归档 ${result.archivedCollected} 条、隐藏 ${result.hiddenVideos} 个已导入视频`;
    });
  }

  function viewJobLogs(job: CollectionJobRow) {
    setLogJobId(job.id);
    setLogLevel('all');
    // 滚动到日志区域
    document.getElementById('collection-logs')?.scrollIntoView({ behavior: 'smooth' });
  }

  const columns: Array<Column<CollectionJobRow>> = [
    {
      key: 'taskId',
      header: '任务 ID',
      cell: (job) => (
        <span className="block max-w-[220px] truncate font-mono text-xs" title={job.taskId}>
          {job.taskId}
        </span>
      ),
    },
    {
      key: 'type',
      header: '类型',
      cell: (job) => <Badge variant="outline">{TYPE_TEXT[job.type] ?? job.type}</Badge>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (job) => (
        <Badge
          variant={
            job.status === 'completed'
              ? 'default'
              : job.status === 'failed'
                ? 'destructive'
                : job.status === 'running'
                  ? 'secondary'
                  : 'outline'
          }
        >
          {STATUS_TEXT[job.status] ?? job.status}
        </Badge>
      ),
    },
    { key: 'priority', header: '优先级', cell: (job) => <span className="text-xs">{job.priority}</span> },
    {
      key: 'retry',
      header: '重试',
      cell: (job) => (
        <span className="text-xs text-muted-foreground">
          {job.retryCount}/{job.maxRetries}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '创建时间',
      cell: (job) => (
        <span className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'error',
      header: '错误信息',
      cell: (job) => (
        <span
          className="block max-w-[220px] truncate text-xs text-red-600"
          title={job.errorMessage ?? undefined}
        >
          {job.errorMessage ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      cell: (job) => (
        <div className="flex items-center gap-1">
          {job.status === 'failed' ? (
            <Button variant="ghost" size="sm" onClick={() => void handleRetry(job.id)}>
              重试
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => viewJobLogs(job)}>
            日志
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="采集任务"
        description="采集队列任务监控与管理（每 15 秒自动刷新）"
        actions={
          <>
            <Button variant="outline" onClick={() => void fetchJobs()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              刷新
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleRetryAllFailed()}
              disabled={failedTotal === 0 || actionBusy !== null}
            >
              {actionBusy === 'retry' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 size-4" />
              )}
              重试全部失败{failedTotal > 0 ? `（${failedTotal}）` : ''}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleClearAllFailed()}
              disabled={failedTotal === 0 || actionBusy !== null}
            >
              {actionBusy === 'clear' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              清除全部失败
            </Button>
            <Button variant="outline" onClick={() => void handleDedupeVideos()} disabled={actionBusy !== null}>
              {actionBusy === 'dedupe' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Copy className="mr-2 size-4" />
              )}
              检查并去除重复
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              新建任务
            </Button>
          </>
        }
      />

      {actionResult ? <p className="text-sm text-muted-foreground">{actionResult}</p> : null}

      {/* 队列实时状态 */}
      {queueStats ? (
        <FilterBar className="mb-0">
          <Badge variant="outline" className="gap-1.5 py-1">
            <Activity className="size-3 text-blue-500" />
            活跃 {queueStats.active}
          </Badge>
          <Badge variant="outline" className="gap-1.5 py-1">
            等待 {queueStats.waiting}
          </Badge>
          <Badge variant={failedTotal > 0 ? 'destructive' : 'outline'} className="gap-1.5 py-1">
            失败任务 {failedTotal}
          </Badge>
          <Badge variant={queueStats.failed > 0 ? 'destructive' : 'outline'} className="gap-1.5 py-1">
            BullMQ 失败 {queueStats.failed}
          </Badge>
        </FilterBar>
      ) : null}

      <FilterBar>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="queued">排队中</SelectItem>
            <SelectItem value="running">进行中</SelectItem>
            <SelectItem value="completed">已完成</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={type}
          onValueChange={(v) => {
            setPage(1);
            setType(v);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="list_crawl">列表爬取</SelectItem>
            <SelectItem value="detail_fetch">详情获取</SelectItem>
            <SelectItem value="play_url_refresh">播放刷新</SelectItem>
            <SelectItem value="r2_transfer">R2 转存</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={jobs}
        rowKey={(job) => job.id}
        loading={loading}
        emptyText="暂无任务，点击右上角「新建任务」发起第一次采集"
      />
      <Pagination meta={meta ?? undefined} onChange={setPage} />

      {/* 日志查看器 */}
      <Card id="collection-logs" className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ScrollText className="size-4" />
            采集日志
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="按任务记录 ID 过滤（点任务行「日志」自动填入）"
              value={logJobId}
              onChange={(e) => setLogJobId(e.target.value)}
              className="w-72"
            />
            {logJobId ? (
              <Button variant="ghost" size="sm" onClick={() => setLogJobId('')}>
                清除
              </Button>
            ) : null}
            <Select value={logLevel} onValueChange={setLogLevel}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="全部级别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部级别</SelectItem>
                <SelectItem value="info">INFO</SelectItem>
                <SelectItem value="warn">警告</SelectItem>
                <SelectItem value="error">错误</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logRange} onValueChange={setLogRange}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="时间范围" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">近 1 小时</SelectItem>
                <SelectItem value="24h">近 24 小时</SelectItem>
                <SelectItem value="7d">近 7 天</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void fetchLogs()} disabled={logsLoading}>
              {logsLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              刷新日志
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {logs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无日志</p>
            ) : (
              <div className="divide-y">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-2 text-xs">
                    <span className="w-36 shrink-0 text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString('zh-CN')}
                    </span>
                    <Badge
                      variant={log.level === 'error' ? 'destructive' : log.level === 'warn' ? 'secondary' : 'outline'}
                      className="shrink-0"
                    >
                      {LEVEL_TEXT[log.level] ?? log.level}
                    </Badge>
                    <span className="min-w-0 flex-1 break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 新建任务弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建采集任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>任务类型</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list_crawl">列表爬取（抓取指定页的视频索引）</SelectItem>
                  <SelectItem value="detail_fetch">详情获取（补全单个视频的元数据）</SelectItem>
                  <SelectItem value="play_url_refresh">播放地址刷新（重新获取 m3u8）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formType === 'list_crawl' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>内容类型</Label>
                  <Select value={formKind} onValueChange={(v) => setFormKind(v as 'gv' | 'mv' | 'tv')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gv">GV</SelectItem>
                      <SelectItem value="mv">MV</SelectItem>
                      <SelectItem value="tv">剧集</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>页码</Label>
                  <Input type="number" min={1} value={formPage} onChange={(e) => setFormPage(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>外部视频 ID</Label>
                  <Input
                    placeholder="目标站视频 ID（数字）"
                    value={formExternalId}
                    onChange={(e) => setFormExternalId(e.target.value)}
                  />
                </div>
                {formType === 'detail_fetch' ? (
                  <div className="space-y-2">
                    <Label>内容类型</Label>
                    <Select value={formKind} onValueChange={(v) => setFormKind(v as 'gv' | 'mv' | 'tv')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gv">GV</SelectItem>
                        <SelectItem value="mv">MV</SelectItem>
                        <SelectItem value="tv">剧集</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <Label>优先级（0-1000，越高越先执行）</Label>
              <Input
                type="number"
                min={0}
                max={1000}
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
              />
            </div>

            {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
              创建任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
