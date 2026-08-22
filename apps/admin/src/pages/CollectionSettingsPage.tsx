// ========================================================================
// 采集系统 - 采集设置页（存储策略 / 调度配置 / 号池配置）
// ========================================================================

import * as React from 'react';
import { Check, Database, Loader2, Play, Save, Settings2, Users } from 'lucide-react';
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
} from '@videox/ui';
import {
  collectionApi,
  type CollectionScheduleSettings,
  type CollectionSettings,
  type CollectionStorageStrategy,
} from '@/lib/api';

type PoolSettingsForm = {
  minAccountCount: string;
  vipWeightMultiplier: string;
  healthCheckIntervalMinutes: string;
  autoRemoveFailedAfterAttempts: string;
};

type ScheduleForm = {
  enabled: boolean;
  pageCountPerRun: string;
  incremental: boolean;
  startTime: string;
};

type StorageForm = {
  mode: CollectionStorageStrategy['mode'];
  growthMode: CollectionStorageStrategy['growthMode'];
  latestDays: string;
  popularViewThreshold: string;
  maxStorageGB: string;
  monthlyBudgetUSD: string;
};

function toScheduleForm(s: CollectionScheduleSettings): ScheduleForm {
  return {
    enabled: s.enabled,
    pageCountPerRun: String(s.pageCountPerRun ?? 10),
    incremental: s.incremental,
    startTime: s.startTime ?? '03:00',
  };
}

export function CollectionSettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [storage, setStorage] = React.useState<StorageForm>({
    mode: 'hybrid',
    growthMode: 'rapid',
    latestDays: '30',
    popularViewThreshold: '10000',
    maxStorageGB: '500',
    monthlyBudgetUSD: '20',
  });
  const [daily, setDaily] = React.useState<ScheduleForm>({
    enabled: true,
    pageCountPerRun: '10',
    incremental: true,
    startTime: '03:00',
  });
  const [weekly, setWeekly] = React.useState<ScheduleForm>({
    enabled: false,
    pageCountPerRun: '50',
    incremental: true,
    startTime: '04:00',
  });
  const [pool, setPool] = React.useState<PoolSettingsForm>({
    minAccountCount: '3',
    vipWeightMultiplier: '3',
    healthCheckIntervalMinutes: '60',
    autoRemoveFailedAfterAttempts: '3',
  });
  const [fullKinds, setFullKinds] = React.useState({ gv: true, mv: true, tv: true });
  const [fullMaxPages, setFullMaxPages] = React.useState('200');
  const [fullRunning, setFullRunning] = React.useState(false);
  const [fullResult, setFullResult] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s: CollectionSettings = await collectionApi.settings();
      setStorage({
        mode: s.storage?.mode ?? 'hybrid',
        growthMode: s.storage?.growthMode ?? 'rapid',
        latestDays: String(s.storage?.latestDays ?? 30),
        popularViewThreshold: String(s.storage?.popularViewThreshold ?? 10000),
        maxStorageGB: String(s.storage?.maxStorageGB ?? 500),
        monthlyBudgetUSD: String(s.storage?.monthlyBudgetUSD ?? 20),
      });
      setDaily(toScheduleForm(s.dailySchedule));
      setWeekly(toScheduleForm(s.weeklySchedule));
      setPool({
        minAccountCount: String(s.pool?.minAccountCount ?? 3),
        vipWeightMultiplier: String(s.pool?.vipWeightMultiplier ?? 3),
        healthCheckIntervalMinutes: String(s.pool?.healthCheckIntervalMinutes ?? 60),
        autoRemoveFailedAfterAttempts: String(s.pool?.autoRemoveFailedAfterAttempts ?? 3),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await collectionApi.updateSettings({
        storage: {
          mode: storage.mode,
          growthMode: storage.growthMode,
          ...(storage.mode === 'hybrid' && {
            latestDays: Math.max(1, Math.min(365, Number(storage.latestDays) || 30)),
            popularViewThreshold: Math.max(0, Number(storage.popularViewThreshold) || 0),
          }),
          ...(storage.maxStorageGB && { maxStorageGB: Number(storage.maxStorageGB) }),
          ...(storage.monthlyBudgetUSD && { monthlyBudgetUSD: Number(storage.monthlyBudgetUSD) }),
        },
        dailySchedule: {
          enabled: daily.enabled,
          pageCountPerRun: Math.max(1, Math.min(200, Number(daily.pageCountPerRun) || 10)),
          incremental: daily.incremental,
          startTime: daily.startTime,
        },
        weeklySchedule: {
          enabled: weekly.enabled,
          pageCountPerRun: Math.max(1, Math.min(500, Number(weekly.pageCountPerRun) || 50)),
          incremental: weekly.incremental,
          startTime: weekly.startTime,
        },
        pool: {
          minAccountCount: Math.max(1, Number(pool.minAccountCount) || 3),
          vipWeightMultiplier: Math.max(1, Math.min(20, Number(pool.vipWeightMultiplier) || 3)),
          healthCheckIntervalMinutes: Math.max(5, Number(pool.healthCheckIntervalMinutes) || 60),
          autoRemoveFailedAfterAttempts: Math.max(1, Number(pool.autoRemoveFailedAfterAttempts) || 3),
        },
      });
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleFullCrawl() {
    const kinds = (['gv', 'mv', 'tv'] as const).filter((k) => fullKinds[k]);
    if (kinds.length === 0) {
      setFullResult('请至少选择一种类型');
      return;
    }
    if (
      !window.confirm(
        `确认启动手动全量抓取？将抓取 ${kinds.join('/').toUpperCase()} 各最多 ${Math.max(1, Number(fullMaxPages) || 200)} 页。每日/每周定时任务不受影响。`,
      )
    ) {
      return;
    }
    setFullRunning(true);
    setFullResult(null);
    try {
      const result = await collectionApi.fullCrawl({
        kinds,
        maxPages: Math.max(1, Math.min(2000, Number(fullMaxPages) || 200)),
      });
      setFullResult(
        `已入队 ${result.enqueued} 条起始任务（${result.kinds.join('/')}，每类最多 ${result.maxPages} 页）。进度请到「采集任务」查看。`,
      );
    } catch (e) {
      setFullResult(e instanceof Error ? e.message : String(e));
    } finally {
      setFullRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">采集设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            存储策略、调度周期与号池保护线（保存后立即生效）
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt ? (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <Check className="size-4" />
              已保存 {savedAt}
            </span>
          ) : null}
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            保存配置
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* 存储策略 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Database className="size-4" />
            存储策略
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>入库模式</Label>
              <Select value={storage.mode} onValueChange={(v) => setStorage((s) => ({ ...s, mode: v as StorageForm['mode'] }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">混合模式（按规则热链 / R2 转存）</SelectItem>
                  <SelectItem value="hotlink_only">纯热链（零存储成本）</SelectItem>
                  <SelectItem value="r2_only">全量 R2 转存</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>站点增长阶段</Label>
              <Select
                value={storage.growthMode}
                onValueChange={(v) => setStorage((s) => ({ ...s, growthMode: v as StorageForm['growthMode'] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rapid">快速增长期（优先全量热链铺量）</SelectItem>
                  <SelectItem value="slow">稳定期（按混合规则执行）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {storage.mode === 'hybrid' ? (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>最新 N 天视频转存</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={storage.latestDays}
                  onChange={(e) => setStorage((s) => ({ ...s, latestDays: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">发布时间在 N 天内的视频走 R2 转存</p>
              </div>
              <div className="space-y-2">
                <Label>热门视频浏览量阈值</Label>
                <Input
                  type="number"
                  min={0}
                  value={storage.popularViewThreshold}
                  onChange={(e) => setStorage((s) => ({ ...s, popularViewThreshold: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">浏览量达到阈值的视频走 R2 转存</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              当前模式为 {storage.mode === 'hotlink_only' ? '纯热链' : '全量转存'}
              ，混合规则已隐藏
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>仓库最大转存量（GB）</Label>
              <Input
                type="number"
                min={1}
                value={storage.maxStorageGB}
                onChange={(e) => setStorage((s) => ({ ...s, maxStorageGB: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>存储预算（美元/月）</Label>
              <Input
                type="number"
                min={0}
                value={storage.monthlyBudgetUSD}
                onChange={(e) => setStorage((s) => ({ ...s, monthlyBudgetUSD: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 调度配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Settings2 className="size-4" />
            定时调度
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScheduleEditor
            title="每日抓取"
            hint="每天在指定时间自动抓取最新页（凌晨低峰期执行）"
            value={daily}
            maxPages={200}
            onChange={setDaily}
          />
          <div className="border-t" />
          <ScheduleEditor
            title="每周补抓"
            hint="每周一次更深的增量补抓（覆盖每日抓取遗漏的历史页）"
            value={weekly}
            maxPages={500}
            onChange={setWeekly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Play className="size-4" />
            手动全量抓取
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            站点冷启动或需要整库铺量时使用。从第 1 页翻到源站末页或指定上限；已入库的会跳过但仍继续翻页。不改每日/每周定时任务。
          </p>
          <div className="flex flex-wrap gap-4">
            {(['gv', 'mv', 'tv'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-foreground"
                  checked={fullKinds[k]}
                  onChange={(e) => setFullKinds((prev) => ({ ...prev, [k]: e.target.checked }))}
                />
                {k.toUpperCase()}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>每类最多抓取页数（1-2000）</Label>
              <Input
                type="number"
                min={1}
                max={2000}
                value={fullMaxPages}
                onChange={(e) => setFullMaxPages(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">每页约 20 条。200 页大约 4000 条/类型。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleFullCrawl()} disabled={fullRunning}>
              {fullRunning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              开始全量抓取
            </Button>
            {fullResult ? <p className="text-sm text-muted-foreground">{fullResult}</p> : null}
          </div>
        </CardContent>
      </Card>

      {/* 号池配置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" />
            号池保护
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>最小账号保护线</Label>
            <Input
              type="number"
              min={1}
              value={pool.minAccountCount}
              onChange={(e) => setPool((s) => ({ ...s, minAccountCount: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">有效账号低于该值时暂停采集</p>
          </div>
          <div className="space-y-2">
            <Label>VIP 账号权重（1-20）</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={pool.vipWeightMultiplier}
              onChange={(e) => setPool((s) => ({ ...s, vipWeightMultiplier: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">VIP 账号被轮询到的概率倍数</p>
          </div>
          <div className="space-y-2">
            <Label>健康检查间隔（分钟）</Label>
            <Input
              type="number"
              min={5}
              value={pool.healthCheckIntervalMinutes}
              onChange={(e) => setPool((s) => ({ ...s, healthCheckIntervalMinutes: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>连续失败自动禁用次数</Label>
            <Input
              type="number"
              min={1}
              value={pool.autoRemoveFailedAfterAttempts}
              onChange={(e) => setPool((s) => ({ ...s, autoRemoveFailedAfterAttempts: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScheduleEditor({
  title,
  hint,
  value,
  maxPages,
  onChange,
}: {
  title: string;
  hint: string;
  value: ScheduleForm;
  maxPages: number;
  onChange: (v: ScheduleForm) => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{title}</span>
            <Badge variant={value.enabled ? 'default' : 'secondary'}>
              {value.enabled ? '已启用' : '已停用'}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ ...value, enabled: v })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>每次抓取页数（1-{maxPages}）</Label>
          <Input
            type="number"
            min={1}
            max={maxPages}
            value={value.pageCountPerRun}
            onChange={(e) => onChange({ ...value, pageCountPerRun: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>执行时间（HH:mm）</Label>
          <Input
            placeholder="03:00"
            pattern="\d{2}:\d{2}"
            value={value.startTime}
            onChange={(e) => onChange({ ...value, startTime: e.target.value })}
          />
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <Label>增量抓取</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {value.incremental ? '只抓新视频，遇已采集即提前停止' : '全量抓取，逐页爬完'}
            </p>
          </div>
          <Switch
            checked={value.incremental}
            onCheckedChange={(v) => onChange({ ...value, incremental: v })}
          />
        </div>
      </div>
    </div>
  );
}
