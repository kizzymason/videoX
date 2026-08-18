import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Pencil, Play, Plus, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AiProfile, AlgoWeights } from '@videox/shared';
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
  Skeleton,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@videox/ui';
import { systemApi, type AiScoreRow } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { PageHeader, SectionTitle } from '../components/Page';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';

const DEFAULT_WEIGHTS: AlgoWeights = {
  affinity: 1,
  quality: 0.8,
  freshness: 0.6,
  completion: 0.9,
  popularity: 0.5,
  aiScore: 0.7,
  affinityHalfLifeDays: 14,
  freshnessHalfLifeDays: 7,
  diversityLambda: 0.25,
  maxPerAuthor: 3,
  maxPerCategory: 6,
  explorationRatio: 0.15,
};

interface WeightSpec {
  key: keyof AlgoWeights;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const SCORE_WEIGHTS: WeightSpec[] = [
  { key: 'affinity', label: '兴趣亲和度', hint: '用户标签画像与视频标签的匹配程度', min: 0, max: 3, step: 0.05 },
  { key: 'quality', label: '内容质量分', hint: '点赞收藏比、举报率等综合质量信号', min: 0, max: 3, step: 0.05 },
  { key: 'completion', label: '完播率', hint: '看完比例高的视频更容易被继续分发', min: 0, max: 3, step: 0.05 },
  { key: 'freshness', label: '新鲜度', hint: '发布越近权重越高', min: 0, max: 3, step: 0.05 },
  { key: 'popularity', label: '热度', hint: '播放量的对数归一化', min: 0, max: 3, step: 0.05 },
  { key: 'aiScore', label: 'AI 评分', hint: 'AI 重排给出的 0-100 分参与最终排序的权重', min: 0, max: 3, step: 0.05 },
];

const DECAY_WEIGHTS: WeightSpec[] = [
  { key: 'affinityHalfLifeDays', label: '兴趣半衰期', hint: '多少天后旧行为的权重衰减一半', min: 1, max: 90, step: 1, suffix: '天' },
  { key: 'freshnessHalfLifeDays', label: '新鲜度半衰期', hint: '视频发布后多少天热度权重减半', min: 1, max: 60, step: 1, suffix: '天' },
];

const DIVERSITY_WEIGHTS: WeightSpec[] = [
  { key: 'diversityLambda', label: 'MMR 多样性系数', hint: '0 只看相关性，1 只看多样性', min: 0, max: 1, step: 0.01 },
  { key: 'explorationRatio', label: '探索比例', hint: '随机注入新内容的占比，防止信息茧房', min: 0, max: 0.9, step: 0.01 },
  { key: 'maxPerAuthor', label: '同作者上限', hint: '一屏内同一作者最多出现次数', min: 1, max: 20, step: 1, suffix: '个' },
  { key: 'maxPerCategory', label: '同分类上限', hint: '一屏内同一分类最多出现次数', min: 1, max: 30, step: 1, suffix: '个' },
];

export function RecommendPage() {
  return (
    <div>
      <PageHeader title="推荐引擎" description="算法权重调参与 AI 重排配置，改完立即对前台推荐流生效" />
      <Tabs defaultValue="algo">
        <TabsList className="mb-4">
          <TabsTrigger value="algo">
            <Sparkles className="size-3.5" />
            算法权重
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Bot className="size-3.5" />
            AI 重排
          </TabsTrigger>
        </TabsList>
        <TabsContent value="algo">
          <AlgoWeightsPanel />
        </TabsContent>
        <TabsContent value="ai">
          <AiPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AlgoWeightsPanel() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<AlgoWeights | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['algo-weights'], queryFn: systemApi.algo });
  React.useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: AlgoWeights) => systemApi.saveAlgo(body),
    onSuccess: async () => {
      toast.success('权重已保存，推荐缓存将在下次刷新时生效');
      await queryClient.invalidateQueries({ queryKey: ['algo-weights'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = draft && data ? JSON.stringify(draft) !== JSON.stringify(data) : false;

  if (isLoading || !draft) {
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
    );
  }

  const renderGroup = (title: string, description: string, specs: WeightSpec[]) => (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 mb-4 text-xs text-muted-foreground">{description}</p>
      <div className="space-y-5">
        {specs.map((spec) => (
          <div key={spec.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">{spec.label}</span>
              <span className="text-xs tabular-nums">
                {Number(draft[spec.key]).toFixed(spec.step < 1 ? 2 : 0)}
                {spec.suffix ? ` ${spec.suffix}` : ''}
              </span>
            </div>
            <Slider
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={[Number(draft[spec.key])]}
              onValueChange={([value]) => setDraft({ ...draft, [spec.key]: value ?? 0 })}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">{spec.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">
          最终得分 = Σ(权重 × 归一化信号)，再经 MMR 重排去重。所有参数写入 <span className="font-mono">algo_weights</span>。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...DEFAULT_WEIGHTS })}>
            <RotateCcw />
            恢复默认
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            <Save />
            保存
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {renderGroup('打分权重', '每项信号在总分中的比重', SCORE_WEIGHTS)}
        {renderGroup('时间衰减', '控制旧行为与老内容的降权速度', DECAY_WEIGHTS)}
        {renderGroup('多样性与探索', '避免推荐流被单一作者或分类刷屏', DIVERSITY_WEIGHTS)}
      </div>
    </div>
  );
}

const PROMPT_PLACEHOLDER = `你是视频内容质量评估专家。针对每个视频，结合标题、简介、标签、时长与互动数据，
给出 0-100 的推荐分与一句话理由。严格返回 JSON 数组：[{"id":"...","score":85,"reason":"..."}]`;

interface AiDraft {
  id?: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPromptTemplate: string;
  temperature: number;
  batchSize: number;
  isActive: boolean;
}

const EMPTY_AI: AiDraft = {
  name: '',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: '',
  systemPrompt: PROMPT_PLACEHOLDER,
  userPromptTemplate: '以下是待评估的视频列表：\n{{videos}}',
  temperature: 0.2,
  batchSize: 10,
  isActive: true,
};

function AiPanel() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<AiDraft | null>(null);
  const [page, setPage] = React.useState(1);

  const profiles = useQuery({ queryKey: ['ai-profiles'], queryFn: systemApi.aiProfiles });
  const runs = useQuery({ queryKey: ['ai-runs'], queryFn: systemApi.aiRuns, refetchInterval: 10_000 });
  const scores = useQuery({ queryKey: ['ai-scores', page], queryFn: () => systemApi.aiScores(page, 20) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ai-profiles'] });

  const save = useMutation({
    mutationFn: (input: AiDraft) => {
      const body: Record<string, unknown> = {
        name: input.name.trim(),
        endpoint: input.endpoint.trim(),
        model: input.model.trim(),
        systemPrompt: input.systemPrompt,
        userPromptTemplate: input.userPromptTemplate,
        temperature: input.temperature,
        batchSize: input.batchSize,
        isActive: input.isActive,
      };
      // 脱敏占位符原样回传等于「不修改」，只有真填了新 key 才带上。
      if (input.apiKey && !input.apiKey.startsWith('•')) body.apiKey = input.apiKey;
      return input.id ? systemApi.updateAiProfile(input.id, body) : systemApi.createAiProfile(body);
    },
    onSuccess: async () => {
      toast.success('已保存');
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => systemApi.deleteAiProfile(id),
    onSuccess: async () => {
      toast.success('已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: (id: string) => systemApi.runAiProfile(id),
    onSuccess: async () => {
      toast.success('打分任务已入队，可在下方查看进度');
      await queryClient.invalidateQueries({ queryKey: ['ai-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = (profile: AiProfile) =>
    setDraft({
      id: profile.id,
      name: profile.name,
      endpoint: profile.endpoint,
      model: profile.model,
      apiKey: profile.apiKey,
      systemPrompt: profile.systemPrompt,
      userPromptTemplate: profile.userPromptTemplate,
      temperature: profile.temperature,
      batchSize: profile.batchSize,
      isActive: profile.isActive,
    });

  const scoreColumns: Column<AiScoreRow>[] = [
    {
      key: 'title',
      header: '视频',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {row.posterUrl ? (
            <img src={row.posterUrl} alt="" loading="lazy" className="h-8 w-14 shrink-0 rounded object-cover" />
          ) : (
            <span className="h-8 w-14 shrink-0 rounded bg-muted" />
          )}
          <span className="max-w-60 truncate font-medium">{row.title}</span>
        </div>
      ),
    },
    {
      key: 'score',
      header: 'AI 评分',
      cell: (row) =>
        row.aiScore == null ? (
          <span className="text-muted-foreground">未评分</span>
        ) : (
          <span
            className={cn(
              'font-semibold tabular-nums',
              row.aiScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : row.aiScore < 50 ? 'text-destructive' : '',
            )}
          >
            {row.aiScore.toFixed(0)}
          </span>
        ),
    },
    {
      key: 'reason',
      header: '理由',
      cell: (row) => <span className="block max-w-90 truncate text-muted-foreground">{row.aiReason ?? '—'}</span>,
    },
    {
      key: 'views',
      header: '播放量',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatNumber(row.viewCount)}</span>,
    },
    {
      key: 'scoredAt',
      header: '评分时间',
      cell: (row) => <span className="text-muted-foreground tabular-nums">{formatDateTime(row.aiScoredAt)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle
          action={
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_AI })}>
              <Plus />
              新建配置
            </Button>
          }
        >
          AI 配置
        </SectionTitle>

        {profiles.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : (profiles.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-14 text-muted-foreground">
            <Bot className="size-7" strokeWidth={1.5} />
            <p className="text-sm">还没有 AI 配置，添加一个 OpenAI 兼容端点即可开跑</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {profiles.data!.map((profile) => (
              <div key={profile.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {profile.name}
                      {profile.isActive ? <Badge variant="secondary">启用中</Badge> : null}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{profile.endpoint}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono font-normal">
                    {profile.model}
                  </Badge>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">温度</dt>
                    <dd className="tabular-nums">{profile.temperature}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">批大小</dt>
                    <dd className="tabular-nums">{profile.batchSize}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">上次运行</dt>
                    <dd className="tabular-nums">{profile.lastRunAt ? formatDateTime(profile.lastRunAt) : '—'}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3">
                  <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(profile.id)}>
                    <Play />
                    立即跑批
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => edit(profile)}>
                    <Pencil />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    title="删除"
                    onClick={async () => {
                      const ok = await confirm({
                        title: '删除该 AI 配置？',
                        description: `“${profile.name}” 删除后历史评分保留，但无法再用它跑批。`,
                        confirmText: '删除',
                        destructive: true,
                      });
                      if (ok) remove.mutate(profile.id);
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>最近跑批</SectionTitle>
        {(runs.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            还没有跑批记录
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>配置</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>开始时间</th>
                  <th>结束时间</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {runs.data!.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.profileName}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="tabular-nums">
                      {item.scoredVideos} / {item.totalVideos}
                    </td>
                    <td className="text-muted-foreground tabular-nums">{formatDateTime(item.startedAt)}</td>
                    <td className="text-muted-foreground tabular-nums">{formatDateTime(item.finishedAt)}</td>
                    <td className="max-w-50 truncate text-destructive">{item.errorMessage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>评分结果</SectionTitle>
        <DataTable
          columns={scoreColumns}
          rows={scores.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={scores.isLoading}
          emptyText="还没有 AI 评分数据"
        />
        <Pagination meta={scores.data?.meta} onChange={setPage} busy={scores.isFetching} />
      </section>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-150">
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑 AI 配置' : '新建 AI 配置'}</DialogTitle>
            <DialogDescription>
              任何兼容 OpenAI Chat Completions 的端点都能接，模型需返回 JSON 数组格式的评分结果。
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="scrollbar-thin max-h-[60vh] space-y-3.5 overflow-y-auto pr-1">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="配置名">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="主力打分模型" />
                </Field>
                <Field label="模型">
                  <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
                </Field>
              </div>
              <Field label="API Endpoint">
                <Input value={draft.endpoint} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} />
              </Field>
              <Field label="API Key" hint={draft.id ? '留空表示不修改已保存的密钥' : '将加密存储，读取时脱敏'}>
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </Field>
              <Field label="System Prompt" hint="约定输出格式，解析失败的条目会被跳过">
                <Textarea rows={5} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
              </Field>
              <Field label="User Prompt 模板" hint="{{videos}} 会被替换为本批视频的元数据 JSON">
                <Textarea
                  rows={3}
                  value={draft.userPromptTemplate}
                  onChange={(e) => setDraft({ ...draft, userPromptTemplate: e.target.value })}
                />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label={`温度 ${draft.temperature.toFixed(2)}`} hint="评分场景建议低温以保证稳定">
                  <Slider
                    min={0}
                    max={2}
                    step={0.05}
                    value={[draft.temperature]}
                    onValueChange={([value]) => setDraft({ ...draft, temperature: value ?? 0 })}
                  />
                </Field>
                <Field label="批大小" hint="一次请求携带多少个视频">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={draft.batchSize}
                    onChange={(e) => setDraft({ ...draft, batchSize: Number(e.target.value) || 1 })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.isActive} onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })} />
                启用（参与定时跑批）
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button
              disabled={save.isPending || !draft?.name.trim() || !draft?.endpoint.trim() || !draft?.model.trim()}
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
