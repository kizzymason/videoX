// ========================================================================
// 采集系统 - 采集视频管理页（列表 / 批量导入 / 发布 / 下架）
// ========================================================================

import * as React from 'react';
import { Download, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import type { PageMeta } from '@videox/shared';
import {
  Badge,
  Button,
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
  Switch,
} from '@videox/ui';
import { DataTable, Pagination, type Column } from '@/components/DataTable';
import { FilterBar, PageHeader } from '@/components/Page';
import { collectionApi, type CollectedVideoRow } from '@/lib/api';

const STATUS_TEXT: Record<string, string> = {
  pending: '待导入',
  imported: '已导入',
  updating: '更新中',
  archived: '已归档',
};

const KIND_TEXT: Record<string, string> = { gv: 'GV', mv: 'MV', tv: '剧集' };

export function CollectionVideosPage() {
  const [videos, setVideos] = React.useState<CollectedVideoRow[]>([]);
  const [meta, setMeta] = React.useState<PageMeta | null>(null);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState('all');
  const [kind, setKind] = React.useState('all');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // 导入弹窗
  const [importOpen, setImportOpen] = React.useState(false);
  const [importScope, setImportScope] = React.useState<'selected' | 'all'>('selected');
  const [pendingTotal, setPendingTotal] = React.useState(0);
  const [autoPublish, setAutoPublish] = React.useState(true);
  const [forceMode, setForceMode] = React.useState('auto');
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<string | null>(null);
  const [importProgress, setImportProgress] = React.useState<string | null>(null);

  const pageSize = 20;

  const fetchVideos = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await collectionApi.videos({
        page,
        pageSize,
        ...(status !== 'all' && { status }),
        ...(kind !== 'all' && { kind }),
        ...(search && { search }),
      });
      setVideos(result.items);
      setMeta(result.meta);
      setSelected(new Set());
      const pending = await collectionApi.pendingCount();
      setPendingTotal(pending.count);
    } catch (error) {
      console.error('获取采集视频失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page, status, kind, search]);

  React.useEffect(() => {
    void fetchVideos();
  }, [fetchVideos]);

  function toggleOne(video: CollectedVideoRow) {
    if (video.status !== 'pending') return;
    const next = new Set(selected);
    if (next.has(video.id)) next.delete(video.id);
    else next.add(video.id);
    setSelected(next);
  }

  function toggleAll() {
    const pendingIds = videos.filter((v) => v.status === 'pending').map((v) => v.id);
    if (pendingIds.length > 0 && pendingIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  }

  async function handleImport() {
    if (importScope === 'selected' && selected.size === 0) return;
    if (importScope === 'all' && pendingTotal === 0) return;

    setImporting(true);
    setImportResult(null);
    setImportProgress(null);
    const force = forceMode !== 'auto' ? (forceMode as 'hotlink' | 'r2_transfer') : undefined;
    const kindFilter = importScope === 'all' && kind !== 'all' ? (kind as 'gv' | 'mv' | 'tv') : undefined;

    try {
      if (importScope === 'selected') {
        const result = await collectionApi.importVideos({
          collectedVideoIds: Array.from(selected),
          autoPublish,
          ...(force && { forceMode: force }),
        });
        setImportResult(formatImportResult(result.imported.length, result.failed));
      } else {
        let imported = 0;
        let failed: Array<{ collectedVideoId: string; error: string }> = [];
        let remaining = pendingTotal;
        while (remaining > 0) {
          setImportProgress(`正在导入，已成功 ${imported} 条，还剩约 ${remaining} 条…`);
          const result = await collectionApi.importVideos({
            allPending: true,
            autoPublish,
            batchSize: 40,
            ...(force && { forceMode: force }),
            ...(kindFilter && { kind: kindFilter }),
          });
          imported += result.imported.length;
          failed = failed.concat(result.failed);
          remaining = result.remaining ?? 0;
          if ((result.processed ?? 0) === 0) break;
        }
        setImportProgress(null);
        setImportResult(formatImportResult(imported, failed));
      }
      await fetchVideos();
    } catch (error) {
      setImportProgress(null);
      setImportResult(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  function formatImportResult(
    imported: number,
    failed: Array<{ collectedVideoId: string; error: string }>,
  ): string {
    return (
      `导入完成：${imported} 成功，${failed.length} 失败` +
      (failed.length > 0 ? `\n失败详情：${failed.map((f) => f.error).slice(0, 3).join('；')}` : '')
    );
  }

  function openImport(scope: 'selected' | 'all') {
    setImportScope(scope);
    setImportResult(null);
    setImportProgress(null);
    setImportOpen(true);
  }

  async function handleUnpublish(id: string) {
    if (!window.confirm('确定下架并归档该视频？')) return;
    try {
      await collectionApi.unpublishVideo(id);
      await fetchVideos();
    } catch (error) {
      console.error('下架失败:', error);
    }
  }

  const pendingIds = videos.filter((v) => v.status === 'pending').map((v) => v.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));

  const columns: Array<Column<CollectedVideoRow>> = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="全选本页待导入项"
          className="size-3.5 accent-foreground"
          checked={allPendingSelected}
          onChange={toggleAll}
        />
      ),
      cell: (v) => (
        <input
          type="checkbox"
          aria-label="选择该行"
          className="size-3.5 accent-foreground"
          checked={selected.has(v.id)}
          onChange={() => toggleOne(v)}
          disabled={v.status !== 'pending'}
        />
      ),
      className: 'w-9',
    },
    {
      key: 'title',
      header: '标题',
      cell: (v) => (
        <span className="block max-w-[320px] truncate font-medium" title={v.title}>
          {v.title}
        </span>
      ),
    },
    {
      key: 'kind',
      header: '类型',
      cell: (v) => <Badge variant="outline">{KIND_TEXT[v.kind] ?? v.kind}</Badge>,
    },
    {
      key: 'externalId',
      header: '外部 ID',
      cell: (v) => <span className="font-mono text-xs">{v.externalId}</span>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (v) => (
        <Badge
          variant={v.status === 'imported' ? 'default' : v.status === 'archived' ? 'secondary' : 'outline'}
        >
          {STATUS_TEXT[v.status] ?? v.status}
        </Badge>
      ),
    },
    {
      key: 'importMode',
      header: '入库方式',
      cell: (v) =>
        v.importMode === 'hotlink' ? '热链' : v.importMode === 'r2_transfer' ? 'R2 转存' : '—',
    },
    {
      key: 'createdAt',
      header: '采集时间',
      cell: (v) => (
        <span className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      cell: (v) => (
        <div className="flex items-center gap-1">
          {v.status === 'imported' ? (
            <Button variant="ghost" size="sm" onClick={() => void handleUnpublish(v.id)}>
              下架
            </Button>
          ) : null}
          {v.status === 'imported' && v.videoId ? (
            <a
              href={`/video/${v.videoId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-muted-foreground hover:text-foreground"
              title="打开视频页"
            >
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="采集视频"
        description="从 yitongkan 采集的视频索引，支持热链快速入库与 R2 转存入库"
        actions={
          <>
            <Button variant="outline" onClick={() => void fetchVideos()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              刷新
            </Button>
            <Button
              variant="outline"
              disabled={pendingTotal === 0 || importing}
              onClick={() => openImport('all')}
            >
              <Download className="mr-2 size-4" />
              导入全部未导入{pendingTotal > 0 ? `（${pendingTotal}）` : ''}
            </Button>
            <Button disabled={selected.size === 0} onClick={() => openImport('selected')}>
              <Download className="mr-2 size-4" />
              导入选中{selected.size > 0 ? `（${selected.size}）` : ''}
            </Button>
          </>
        }
      />

      <FilterBar>
        <form
          className="relative w-64"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput);
          }}
        >
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索标题…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </form>
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
            <SelectItem value="pending">待导入</SelectItem>
            <SelectItem value="imported">已导入</SelectItem>
            <SelectItem value="archived">已归档</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={kind}
          onValueChange={(v) => {
            setPage(1);
            setKind(v);
          }}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="gv">GV</SelectItem>
            <SelectItem value="mv">MV</SelectItem>
            <SelectItem value="tv">剧集</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={videos}
        rowKey={(v) => v.id}
        loading={loading}
        emptyText="暂无采集数据，请先在「采集任务」页创建列表爬取任务"
      />
      <Pagination meta={meta ?? undefined} onChange={setPage} />
      <p className="mt-1 text-xs text-muted-foreground">已选 {selected.size} 条（只有待导入状态可勾选）</p>

      {/* 导入配置弹窗 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {importScope === 'all'
                ? `导入全部未导入（${kind !== 'all' ? `${kind.toUpperCase()} ` : ''}${pendingTotal}）`
                : `导入选中的 ${selected.size} 个视频`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">自动发布</Label>
                <p className="text-xs text-muted-foreground">开启后直接 public 上线；关闭则 unlisted 待审核</p>
              </div>
              <Switch checked={autoPublish} onCheckedChange={setAutoPublish} />
            </div>
            <div className="space-y-2">
              <Label>存储方式</Label>
              <Select value={forceMode} onValueChange={setForceMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动决策（按存储策略）</SelectItem>
                  <SelectItem value="hotlink">强制热链（零存储成本）</SelectItem>
                  <SelectItem value="r2_transfer">强制 R2 转存</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {importScope === 'all'
                  ? '会按批次导入所有待导入记录，直到队列清空。热链较快；R2 转存很慢，量大时请分批观察。'
                  : '热链模式即时完成；R2 转存会下载全部分片（较慢，任务量大时建议分批）'}
              </p>
            </div>
            {importProgress ? <p className="text-sm text-muted-foreground">{importProgress}</p> : null}
            {importResult ? (
              <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {importResult}
              </pre>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              关闭
            </Button>
            <Button onClick={() => void handleImport()} disabled={importing}>
              {importing && <Loader2 className="mr-2 size-4 animate-spin" />}
              开始导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
