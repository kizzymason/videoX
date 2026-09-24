// ========================================================================
// SEO 系统 - 管理页
// 概览 / 推送与 AI 设置 / 关键词管理 / 推送记录
// ========================================================================

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Check,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@videox/ui';
import type { SeoSettings, VideoSeoItem } from '@videox/shared';
import { seoApi } from '@/lib/api';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function ReadyBadge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <Badge variant={ready ? 'default' : 'secondary'} className={ready ? 'bg-green-600' : ''}>
      {label}
      {ready ? '已就绪' : '未配置'}
    </Badge>
  );
}

// --------------------------------------------------------------------------
// 概览卡片
// --------------------------------------------------------------------------

function OverviewCards() {
  const { data } = useQuery({ queryKey: ['seo-overview'], queryFn: seoApi.overview, refetchInterval: 30_000 });
  if (!data) return null;

  const coverage = data.publishedVideos > 0 ? Math.round((data.seoGenerated / data.publishedVideos) * 100) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">已发布视频</p>
          <p className="mt-1 text-2xl font-bold">{data.publishedVideos}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            AI 关键词覆盖 {data.seoGenerated} 条（{coverage}%），待生成 {data.seoMissing} 条
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">IndexNow（Bing/Yandex 等）</p>
          <p className="mt-1 text-2xl font-bold">{data.submissions.indexnow.success}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            成功推送，失败 {data.submissions.indexnow.failed} 条
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">百度推送</p>
          <p className="mt-1 text-2xl font-bold">{data.submissions.baidu.success}</p>
          <p className="mt-1 text-xs text-muted-foreground">成功推送，失败 {data.submissions.baidu.failed} 条</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">最近运行</p>
          <p className="mt-1 text-sm">自动推送：{formatTime(data.lastAutoPushAt)}</p>
          <p className="text-sm">AI 生成：{formatTime(data.lastAiRunAt)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ReadyBadge ready={data.indexNowReady} label="IndexNow " />
            <ReadyBadge ready={data.baiduReady} label="百度 " />
            <ReadyBadge ready={data.aiReady} label="AI " />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------
// 设置 Tab
// --------------------------------------------------------------------------

function SettingsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['seo-settings'], queryFn: seoApi.settings });
  const [form, setForm] = React.useState<SeoSettings | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (body: SeoSettings) => seoApi.saveSettings(body),
    onSuccess: (saved) => {
      setForm(saved);
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['seo-overview'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const keyMutation = useMutation({
    mutationFn: seoApi.generateIndexNowKey,
    onSuccess: ({ key }) => {
      setForm((f) => (f ? { ...f, indexNow: { ...f.indexNow, key } } : f));
      void queryClient.invalidateQueries({ queryKey: ['seo-settings'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (isLoading || !form) {
    return (
      <div className="grid h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const set = (patch: Partial<SeoSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        {savedAt ? (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="size-4" />
            已保存 {savedAt}
          </span>
        ) : null}
        <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          保存设置
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Send className="size-4" />
            自动推送
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">新视频自动推送给搜索引擎</p>
              <p className="text-xs text-muted-foreground">每 10 分钟扫描一次新发布且未推送的视频，失败每 6 小时自动重试</p>
            </div>
            <Switch
              checked={form.autoPushEnabled}
              onCheckedChange={(v) => set({ autoPushEnabled: v })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>单轮推送上限（条）</Label>
              <Input
                type="number"
                value={form.pushBatchSize}
                onChange={(e) => set({ pushBatchSize: Number(e.target.value) || 200 })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Globe className="size-4" />
            IndexNow（Bing / Yandex / Naver / Seznam，间接覆盖 ChatGPT Search / Copilot / DuckDuckGo）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <p className="text-sm font-medium">启用 IndexNow 推送</p>
            <Switch
              checked={form.indexNow.enabled}
              onCheckedChange={(v) => set({ indexNow: { ...form.indexNow, enabled: v } })}
            />
          </div>
          <div className="space-y-2">
            <Label>IndexNow key</Label>
            <div className="flex gap-2">
              <Input
                value={form.indexNow.key}
                onChange={(e) => set({ indexNow: { ...form.indexNow, key: e.target.value.trim() } })}
                placeholder="点击右侧按钮自动生成"
                className="font-mono"
              />
              <Button variant="outline" onClick={() => keyMutation.mutate()} disabled={keyMutation.isPending}>
                {keyMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <KeyRound className="mr-2 size-4" />}
                生成
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              系统会自动在 <code>https://你的域名/{form.indexNow.key || '{key}'}.txt</code> 提供校验文件，无需手动上传。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Search className="size-4" />
            百度主动推送
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <p className="text-sm font-medium">启用百度推送（普通收录 API，最快的收录通道）</p>
            <Switch
              checked={form.baidu.enabled}
              onCheckedChange={(v) => set({ baidu: { ...form.baidu, enabled: v } })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>站点（与百度站长平台完全一致，含协议）</Label>
              <Input
                value={form.baidu.site}
                onChange={(e) => set({ baidu: { ...form.baidu, site: e.target.value.trim() } })}
                placeholder="https://example.com（留空用系统站点地址）"
              />
            </div>
            <div className="space-y-2">
              <Label>准入密钥 token</Label>
              <Input
                value={form.baidu.token}
                onChange={(e) => set({ baidu: { ...form.baidu, token: e.target.value.trim() } })}
                placeholder="百度搜索资源平台 → 普通收录 → API 提交"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Bot className="size-4" />
            AI 关键词优化
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">自动为新视频生成 SEO 标题 / 描述 / 关键词</p>
              <p className="text-xs text-muted-foreground">每天 02:30 批量处理未生成的视频，结果用于页面 meta、sitemap 与爬虫渲染</p>
            </div>
            <Switch checked={form.ai.enabled} onCheckedChange={(v) => set({ ai: { ...form.ai, enabled: v } })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>接口地址（OpenAI 兼容）</Label>
              <Input
                value={form.ai.endpoint}
                onChange={(e) => set({ ai: { ...form.ai, endpoint: e.target.value.trim() } })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                value={form.ai.apiKey}
                onChange={(e) => set({ ai: { ...form.ai, apiKey: e.target.value.trim() } })}
              />
            </div>
            <div className="space-y-2">
              <Label>模型</Label>
              <Input
                value={form.ai.model}
                onChange={(e) => set({ ai: { ...form.ai, model: e.target.value.trim() } })}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="space-y-2">
              <Label>每日生成上限（条）</Label>
              <Input
                type="number"
                value={form.ai.dailyLimit}
                onChange={(e) => set({ ai: { ...form.ai, dailyLimit: Number(e.target.value) || 300 } })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>站点定位说明（帮助 AI 选词，可留空）</Label>
            <Textarea
              value={form.ai.siteContext}
              onChange={(e) => set({ ai: { ...form.ai, siteContext: e.target.value } })}
              placeholder="例如：面向华语用户的高清视频平台，主打……"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            首页 SEO
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>首页标题（搜索结果标题，留空用站点名称；不要再拼副标题）</Label>
            <Input
              value={form.pages.homeTitle}
              onChange={(e) => set({ pages: { ...form.pages, homeTitle: e.target.value } })}
              placeholder="PandaGV - Gay Videos & GV 男同视频"
            />
          </div>
          <div className="space-y-2">
            <Label>首页关键词（逗号分隔，留空用「站点设置」里的全站关键词）</Label>
            <Input
              value={form.pages.homeKeywords}
              onChange={(e) => set({ pages: { ...form.pages, homeKeywords: e.target.value } })}
            />
          </div>
          <div className="space-y-2">
            <Label>首页描述（120–160 字人话，留空用站点描述）</Label>
            <Textarea
              value={form.pages.homeDescription}
              onChange={(e) => set({ pages: { ...form.pages, homeDescription: e.target.value } })}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------
// 关键词 Tab
// --------------------------------------------------------------------------

function KeywordRow({ item }: { item: VideoSeoItem }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [seoTitle, setSeoTitle] = React.useState(item.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = React.useState(item.seoDescription ?? '');
  const [keywords, setKeywords] = React.useState(item.keywords.join(', '));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['seo-keywords'] });

  const generateMutation = useMutation({
    mutationFn: () => seoApi.generateVideoSeo(item.videoId),
    onSuccess: refresh,
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      seoApi.saveVideoSeo(item.videoId, {
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
        keywords: keywords
          .split(/[,，]/)
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20),
      }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.keywords.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.keywords.map((k) => (
                <Badge key={k} variant="secondary" className="text-xs">
                  {k}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">尚未生成关键词</p>
          )}
          {item.seoDescription ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.seoDescription}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.source ? (
            <Badge variant="outline" className="text-xs">
              {item.source === 'ai' ? `AI · ${item.aiModel ?? ''}` : '手动'}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Wand2 className="mr-1 size-3.5" />}
            AI 生成
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? '收起' : '编辑'}
          </Button>
        </div>
      </div>
      {generateMutation.isError ? (
        <p className="mt-2 text-xs text-red-600">
          {generateMutation.error instanceof Error ? generateMutation.error.message : '生成失败'}
        </p>
      ) : null}
      {editing ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs">SEO 标题</Label>
            <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={item.title} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">SEO 描述</Label>
            <Textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">关键词（逗号分隔）</Label>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Save className="mr-1 size-3.5" />}
            保存
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function KeywordsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState<'all' | 'missing' | 'generated'>('all');
  const [search, setSearch] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');
  const [batchLimit, setBatchLimit] = React.useState('50');
  const [batchResult, setBatchResult] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['seo-keywords', page, filter, search],
    queryFn: () => seoApi.keywords({ page, pageSize: 20, filter, q: search || undefined }),
  });

  const batchMutation = useMutation({
    mutationFn: () => seoApi.runKeywordBatch(Math.max(1, Math.min(1000, Number(batchLimit) || 50))),
    onSuccess: (result) => {
      setBatchResult(`已处理 ${result.processed} 条：成功 ${result.succeeded}，失败 ${result.failed}`);
      void queryClient.invalidateQueries({ queryKey: ['seo-keywords'] });
      void queryClient.invalidateQueries({ queryKey: ['seo-overview'] });
    },
    onError: (e) => setBatchResult(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label className="text-xs">批量生成条数</Label>
            <Input className="w-28" type="number" value={batchLimit} onChange={(e) => setBatchLimit(e.target.value)} />
          </div>
          <Button onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
            {batchMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wand2 className="mr-2 size-4" />}
            批量 AI 生成（未生成的视频）
          </Button>
          {batchResult ? <p className="text-sm text-muted-foreground">{batchResult}</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={(v) => { setFilter(v as typeof filter); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部视频</SelectItem>
            <SelectItem value="missing">未生成关键词</SelectItem>
            <SelectItem value="generated">已生成关键词</SelectItem>
          </SelectContent>
        </Select>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <Input className="w-56" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="搜索视频标题" />
          <Button type="submit" variant="outline">
            <Search className="size-4" />
          </Button>
        </form>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {(data?.items ?? []).map((item) => (
            <KeywordRow key={item.videoId} item={item} />
          ))}
          {data && data.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的视频</p>
          ) : null}
        </div>
      )}

      {data && data.meta.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {data.meta.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// 推送记录 Tab
// --------------------------------------------------------------------------

function SubmissionsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [engine, setEngine] = React.useState<'all' | 'indexnow' | 'baidu'>('all');
  const [status, setStatus] = React.useState<'all' | 'success' | 'failed'>('all');
  const [manualUrls, setManualUrls] = React.useState('');
  const [actionResult, setActionResult] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['seo-submissions', page, engine, status],
    queryFn: () =>
      seoApi.submissions({
        page,
        pageSize: 30,
        engine: engine === 'all' ? undefined : engine,
        status: status === 'all' ? undefined : status,
      }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['seo-submissions'] });
    void queryClient.invalidateQueries({ queryKey: ['seo-overview'] });
  };

  const describeResults = (results: { engine: string; submitted: number; succeeded: number; failed: number; message?: string }[]) => {
    if (results.length === 0) return '没有需要推送的内容或推送引擎未启用';
    return results
      .map((r) => `${r.engine === 'indexnow' ? 'IndexNow' : '百度'}：提交 ${r.submitted}，成功 ${r.succeeded}，失败 ${r.failed}${r.message ? `（${r.message}）` : ''}`)
      .join('；');
  };

  const pushMutation = useMutation({
    mutationFn: (body: { urls?: string[]; scope?: 'new' | 'all' }) => seoApi.push(body),
    onSuccess: (results) => {
      setActionResult(describeResults(results));
      refresh();
    },
    onError: (e) => setActionResult(e instanceof Error ? e.message : String(e)),
  });

  const retryMutation = useMutation({
    mutationFn: seoApi.retryPush,
    onSuccess: (results) => {
      setActionResult(describeResults(results));
      refresh();
    },
    onError: (e) => setActionResult(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">手动推送</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => pushMutation.mutate({ scope: 'new' })} disabled={pushMutation.isPending}>
              {pushMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              推送未推送的视频
            </Button>
            <Button
              variant="outline"
              disabled={pushMutation.isPending}
              onClick={() => {
                if (window.confirm('全量重推会把所有已发布视频重新提交一遍，占用当日推送配额，确认执行？')) {
                  pushMutation.mutate({ scope: 'all' });
                }
              }}
            >
              全量重推
            </Button>
            <Button variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              {retryMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              重试失败记录
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">指定 URL 推送（每行一个，支持站内路径如 /watch/xxx）</Label>
            <Textarea value={manualUrls} onChange={(e) => setManualUrls(e.target.value)} rows={3} placeholder="/watch/some-video" />
            <Button
              size="sm"
              variant="outline"
              disabled={pushMutation.isPending || !manualUrls.trim()}
              onClick={() => {
                const urls = manualUrls
                  .split('\n')
                  .map((u) => u.trim())
                  .filter(Boolean);
                if (urls.length > 0) pushMutation.mutate({ urls });
              }}
            >
              推送这些 URL
            </Button>
          </div>
          {actionResult ? <p className="text-sm text-muted-foreground">{actionResult}</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={engine} onValueChange={(v) => { setEngine(v as typeof engine); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部引擎</SelectItem>
            <SelectItem value="indexnow">IndexNow</SelectItem>
            <SelectItem value="baidu">百度</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">引擎</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">次数</th>
                <th className="px-3 py-2 font-medium">响应</th>
                <th className="px-3 py-2 font-medium">最近推送</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs">{row.url}</td>
                  <td className="px-3 py-2">{row.engine === 'indexnow' ? 'IndexNow' : '百度'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.status === 'success' ? 'default' : row.status === 'failed' ? 'destructive' : 'secondary'}>
                      {row.status === 'success' ? '成功' : row.status === 'failed' ? '失败' : '待推送'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{row.attempts}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-xs text-muted-foreground">{row.response ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatTime(row.submittedAt)}</td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    暂无推送记录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {data && data.meta.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {data.meta.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// 页面
// --------------------------------------------------------------------------

export function SeoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SEO 管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          搜索引擎主动推送（IndexNow / 百度）、AI 关键词优化与推送记录。爬虫渲染与 sitemap 自动使用这里的数据。
        </p>
      </div>

      <OverviewCards />

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">推送与 AI 设置</TabsTrigger>
          <TabsTrigger value="keywords">关键词管理</TabsTrigger>
          <TabsTrigger value="submissions">推送记录</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="keywords" className="mt-4">
          <KeywordsTab />
        </TabsContent>
        <TabsContent value="submissions" className="mt-4">
          <SubmissionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
