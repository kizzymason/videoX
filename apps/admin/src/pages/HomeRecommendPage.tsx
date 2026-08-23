import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Search, Star, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { VideoSummary } from '@videox/shared';
import { Badge, Button, Field, Input, Skeleton } from '@videox/ui';
import { catalogApi, videosApi, type HomeRecommendKeyword, type HomeRecommendPin } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { PageHeader, SectionTitle } from '../components/Page';
import { useConfirm } from '../components/ConfirmDialog';

export function HomeRecommendPage() {
  return (
    <div>
      <PageHeader
        title="首页推荐"
        description="手动置顶的视频会排在默认推荐之前；升降权关键词会改写首页与发现页的排序"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <PinnedVideosPanel />
        <KeywordsPanel />
      </div>
    </div>
  );
}

function PinnedVideosPanel() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [q]);

  const pins = useQuery({ queryKey: ['home-recommend-pins'], queryFn: catalogApi.homePins });
  const search = useQuery({
    queryKey: ['home-recommend-search', debounced],
    queryFn: () => videosApi.list({ q: debounced, page: 1, pageSize: 8, kind: 'vod' }),
    enabled: debounced.length > 0,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['home-recommend-pins'] });
  const pinnedIds = new Set((pins.data ?? []).map((row) => row.videoId));

  const add = useMutation({
    mutationFn: (videoId: string) => catalogApi.addHomePin(videoId),
    onSuccess: async () => {
      toast.success('已加入推荐视图');
      setQ('');
      setDebounced('');
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => catalogApi.reorderHomePins(ids),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.removeHomePin(id),
    onSuccess: async () => {
      toast.success('已移出推荐视图');
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const move = (index: number, delta: number) => {
    const list = [...(pins.data ?? [])];
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    const swapped = list[index]!;
    list[index] = list[next]!;
    list[next] = swapped;
    void reorder.mutateAsync(list.map((row) => row.id));
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle>推荐视图</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        按名称搜索点播视频加入置顶。置顶顺序就是首页「推荐」最前面的顺序，排在算法和默认列表之上。
      </p>

      <Field label="按名称搜索加入">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="输入视频标题…"
            className="pl-8"
          />
        </div>
      </Field>

      {debounced ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          {search.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (search.data?.items ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的点播视频</p>
          ) : (
            <ul className="divide-y divide-border">
              {(search.data?.items ?? []).map((video) => (
                <li key={video.id} className="flex items-center gap-2 px-3 py-2">
                  <VideoThumb video={video} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{video.title}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{video.viewCount} 播放</p>
                  </div>
                  {pinnedIds.has(video.id) ? (
                    <Badge variant="secondary">已加入</Badge>
                  ) : (
                    <Button size="sm" disabled={add.isPending} onClick={() => add.mutate(video.id)}>
                      <Plus />
                      加入
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mt-5">
        <SectionTitle>当前置顶（{pins.data?.length ?? 0}）</SectionTitle>
        {pins.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : (pins.data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
            <Star className="size-6" strokeWidth={1.5} />
            <p className="text-sm">还没有手动置顶，首页会走默认推荐</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {(pins.data ?? []).map((row, index) => (
              <PinRow
                key={row.id}
                row={row}
                index={index}
                total={pins.data!.length}
                busy={reorder.isPending || remove.isPending}
                onMove={move}
                onRemove={async () => {
                  const ok = await confirm({
                    title: '移出推荐视图？',
                    description: `“${row.video.title}” 会回到默认排序，不会删除视频本身。`,
                    confirmText: '移出',
                    destructive: true,
                  });
                  if (ok) remove.mutate(row.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {dialog}
    </section>
  );
}

function PinRow({
  row,
  index,
  total,
  busy,
  onMove,
  onRemove,
}: {
  row: HomeRecommendPin;
  index: number;
  total: number;
  busy: boolean;
  onMove: (index: number, delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
      <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <VideoThumb video={row.video} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.video.title}</p>
        <p className="text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</p>
      </div>
      <div className="flex items-center">
        <Button variant="ghost" size="icon" disabled={busy || index === 0} title="上移" onClick={() => onMove(index, -1)}>
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || index === total - 1}
          title="下移"
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" disabled={busy} title="移出" onClick={() => void onRemove()}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>
    </li>
  );
}

function KeywordsPanel() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [keyword, setKeyword] = React.useState('');
  const [weight, setWeight] = React.useState('1');

  const list = useQuery({ queryKey: ['home-recommend-keywords'], queryFn: catalogApi.homeKeywords });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['home-recommend-keywords'] });

  const add = useMutation({
    mutationFn: (direction: 'boost' | 'penalty') =>
      catalogApi.addHomeKeyword({
        keyword: keyword.trim(),
        direction,
        weight: Number(weight) || 1,
      }),
    onSuccess: async () => {
      toast.success('关键词已添加');
      setKeyword('');
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: ({ id, weight: next }: { id: string; weight: number }) => catalogApi.updateHomeKeyword(id, { weight: next }),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteHomeKeyword(id),
    onSuccess: async () => {
      toast.success('关键词已删除');
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const boosts = (list.data ?? []).filter((item) => item.direction === 'boost');
  const penalties = (list.data ?? []).filter((item) => item.direction === 'penalty');

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle>升降权关键词</SectionTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        命中视频标题、简介或标签时加减分。升权让相关内容更靠前，降权则压下去，作用在首页推荐排序上。
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem]">
        <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：独家 / 广告" />
        <Input
          type="number"
          min={0.05}
          max={20}
          step={0.1}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          title="权重"
        />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={add.isPending || !keyword.trim()}
          onClick={() => add.mutate('boost')}
        >
          <TrendingUp />
          加入升权
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={add.isPending || !keyword.trim()}
          onClick={() => add.mutate('penalty')}
        >
          <TrendingDown />
          加入降权
        </Button>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-5">
          <KeywordGroup
            title="升权"
            empty="还没有升权词"
            items={boosts}
            onWeight={(id, next) => update.mutate({ id, weight: next })}
            onRemove={async (item) => {
              const ok = await confirm({
                title: '删除升权词？',
                description: `“${item.keyword}” 将不再提升相关视频。`,
                confirmText: '删除',
                destructive: true,
              });
              if (ok) remove.mutate(item.id);
            }}
          />
          <KeywordGroup
            title="降权"
            empty="还没有降权词"
            items={penalties}
            onWeight={(id, next) => update.mutate({ id, weight: next })}
            onRemove={async (item) => {
              const ok = await confirm({
                title: '删除降权词？',
                description: `“${item.keyword}” 将不再压低相关视频。`,
                confirmText: '删除',
                destructive: true,
              });
              if (ok) remove.mutate(item.id);
            }}
          />
        </div>
      )}
      {dialog}
    </section>
  );
}

function KeywordGroup({
  title,
  empty,
  items,
  onWeight,
  onRemove,
}: {
  title: string;
  empty: string;
  items: HomeRecommendKeyword[];
  onWeight: (id: string, weight: number) => void;
  onRemove: (item: HomeRecommendKeyword) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <Badge variant={item.direction === 'boost' ? 'secondary' : 'outline'}>{item.keyword}</Badge>
              <Input
                type="number"
                min={0.05}
                max={20}
                step={0.1}
                defaultValue={item.weight}
                className="ml-auto h-8 w-20"
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next) || next === item.weight) return;
                  onWeight(item.id, next);
                }}
              />
              <Button variant="ghost" size="icon" title="删除" onClick={() => void onRemove(item)}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VideoThumb({ video }: { video: VideoSummary }) {
  return video.posterUrl ? (
    <img src={video.posterUrl} alt="" className="h-10 w-[4.5rem] shrink-0 rounded object-cover" />
  ) : (
    <span className="h-10 w-[4.5rem] shrink-0 rounded bg-muted" />
  );
}
