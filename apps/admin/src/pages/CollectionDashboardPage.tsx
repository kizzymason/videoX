// ========================================================================
// 采集系统 - 数据总览页（Dashboard）
// ========================================================================

import * as React from 'react';
import { Activity, Database, Film, Link2, Loader2, RefreshCw, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@videox/ui';
import { collectionApi, type CollectionStats } from '@/lib/api';

export function CollectionDashboardPage() {
  const [stats, setStats] = React.useState<CollectionStats | null>(null);
  const [trend, setTrend] = React.useState<Array<{ date: string; count: number }>>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([collectionApi.stats(), collectionApi.trend(14)]);
      setStats(s);
      setTrend(t);
    } catch (error) {
      console.error('加载采集统计失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    // 30 秒自动刷新队列状态
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const maxCount = Math.max(1, ...trend.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">采集总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            yitongkan 视频采集系统运行状态（每 30 秒自动刷新）
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          刷新
        </Button>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="今日新增采集"
          value={stats?.videos.todayNew ?? '—'}
          hint={`累计 ${stats?.videos.total ?? 0} 条记录`}
          icon={<Film className="size-4" />}
        />
        <StatCard
          title="今日任务"
          value={stats?.todayTasks.total ?? '—'}
          hint={`完成 ${stats?.todayTasks.completed ?? 0} · 失败 ${stats?.todayTasks.failed ?? 0}`}
          icon={<Activity className="size-4" />}
        />
        <StatCard
          title="号池在线"
          value={stats ? `${stats.pool.active}/${stats.pool.total}` : '—'}
          hint={`VIP ${stats?.pool.vip ?? 0} · 普通 ${stats?.pool.free ?? 0}`}
          icon={<Users className="size-4" />}
        />
        <StatCard
          title="队列实时"
          value={stats ? `${stats.queue.active} 活跃 / ${stats.queue.waiting} 等待` : '—'}
          hint={`历史失败 ${stats?.queue.failed ?? 0}`}
          icon={<Database className="size-4" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 采集趋势 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">每日采集趋势（近 14 天）</CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">暂无采集数据</p>
            ) : (
              <div className="flex h-40 items-end gap-1.5">
                {trend.map((d) => (
                  <div key={d.date} className="group flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${Math.max(4, (d.count / maxCount) * 100)}%` }}
                      title={`${d.date}: ${d.count} 条`}
                    />
                    <span className="text-[10px] text-muted-foreground">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 存储分布 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">入库方式分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Link2 className="size-3.5 text-blue-500" /> 热链直连
                </span>
                <span className="text-muted-foreground">{stats?.videos.hotlink ?? 0}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-blue-500"
                  style={{
                    width: `${stats && stats.videos.hotlink + stats.videos.r2 > 0
                      ? (stats.videos.hotlink / (stats.videos.hotlink + stats.videos.r2)) * 100
                      : 0}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Database className="size-3.5 text-emerald-500" /> R2 转存
                </span>
                <span className="text-muted-foreground">{stats?.videos.r2 ?? 0}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${stats && stats.videos.hotlink + stats.videos.r2 > 0
                      ? (stats.videos.r2 / (stats.videos.hotlink + stats.videos.r2)) * 100
                      : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">待导入</span>
              <Badge variant="secondary">{stats?.videos.pending ?? 0}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已导入</span>
              <Badge variant="outline">{stats?.videos.imported ?? 0}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 号池健康度 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">号池健康度</CardTitle>
        </CardHeader>
        <CardContent>
          {stats ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <HealthItem label="有效" value={stats.pool.active} total={stats.pool.total} color="text-green-600" />
              <HealthItem label="失效" value={stats.pool.inactive} total={stats.pool.total} color="text-yellow-600" />
              <HealthItem label="封禁" value={stats.pool.banned} total={stats.pool.total} color="text-red-600" />
              <HealthItem
                label="健康率"
                value={stats.pool.total > 0 ? `${Math.round((stats.pool.active / stats.pool.total) * 100)}%` : '—'}
                total={1}
                color="text-primary"
                isPercent
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function HealthItem({
  label,
  value,
  total,
  color,
  isPercent,
}: {
  label: string;
  value: number | string;
  total: number;
  color: string;
  isPercent?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${color}`}>{value}</span>
      </div>
      {!isPercent && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${color.replace('text-', 'bg-')}`}
            style={{ width: `${total > 0 ? (Number(value) / total) * 100 : 0}%` }}
          />
        </div>
      )}
    </div>
  );
}
