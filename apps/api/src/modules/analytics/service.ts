import { UAParser } from 'ua-parser-js';
import { sql } from 'drizzle-orm';
import type { AnalyticsPayload, BreakdownItem, TrendPoint, VisitorInsights } from '@videox/shared';
import { db, t, sqlRows } from '../../core/db.js';
import { getRedis } from '../../core/redis.js';
import { logger } from '../../core/logger.js';

export interface CollectContext {
  ip: string;
  userAgent: string;
  userId: string | null;
}

interface ParsedClient {
  deviceType: string;
  browser: string;
  os: string;
}

const uaCache = new Map<string, ParsedClient>();

/** UA 解析开销不小且重复率极高，做一层有界缓存。 */
export function parseClient(userAgent: string): ParsedClient {
  const key = userAgent.slice(0, 200);
  const hit = uaCache.get(key);
  if (hit) return hit;

  const parsed = UAParser(key);
  const value: ParsedClient = {
    deviceType: parsed.device.type ?? 'desktop',
    browser: parsed.browser.name ?? 'Unknown',
    os: parsed.os.name ?? 'Unknown',
  };

  if (uaCache.size > 2000) uaCache.clear();
  uaCache.set(key, value);
  return value;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

const ONLINE_KEY = 'analytics:online';
const PLAYING_KEY = 'analytics:playing';
const ONLINE_WINDOW_MS = 5 * 60_000;

/** 用 Redis 有序集合维护在线状态：score 是最后活跃时间戳，过期成员定期裁掉。 */
async function touchOnline(sessionId: string, playing: boolean): Promise<void> {
  const redis = getRedis();
  const now = Date.now();
  try {
    const pipeline = redis.pipeline();
    pipeline.zadd(ONLINE_KEY, now, sessionId);
    pipeline.zremrangebyscore(ONLINE_KEY, 0, now - ONLINE_WINDOW_MS);
    if (playing) {
      pipeline.zadd(PLAYING_KEY, now, sessionId);
      pipeline.zremrangebyscore(PLAYING_KEY, 0, now - 90_000);
    }
    await pipeline.exec();
  } catch (error) {
    logger.debug({ err: error }, '在线状态写入失败');
  }
}

export async function getRealtimeStats(): Promise<{ onlineUsers: number; playingNow: number; last30MinViews: number }> {
  const redis = getRedis();
  const now = Date.now();
  let onlineUsers = 0;
  let playingNow = 0;
  try {
    onlineUsers = await redis.zcount(ONLINE_KEY, now - ONLINE_WINDOW_MS, '+inf');
    playingNow = await redis.zcount(PLAYING_KEY, now - 90_000, '+inf');
  } catch {
    // Redis 不可用时不阻塞仪表盘。
  }

  const [row] = await sqlRows<{ c: number }>(sql`
    SELECT count(*)::int AS c FROM analytics_events
    WHERE event = 'video_play' AND created_at > now() - interval '30 minutes'
  `);
  return { onlineUsers, playingNow, last30MinViews: Number(row?.c ?? 0) };
}

/**
 * 接收一批埋点。会话首次出现时落 analytics_sessions，
 * 后续只更新计数与最后活跃时间，把写放大控制在可接受范围。
 */
export async function collectEvents(events: AnalyticsPayload[], ctx: CollectContext): Promise<void> {
  if (events.length === 0) return;

  const first = events[0]!;
  const client = parseClient(ctx.userAgent);
  const referrer = events.find((e) => e.referrer)?.referrer;
  const utm = events.find((e) => e.utm && Object.keys(e.utm).length > 0)?.utm ?? {};
  const landing = events.find((e) => e.path)?.path ?? null;

  const pageviews = events.filter((e) => e.event === 'pageview').length;
  const hasPlay = events.some((e) => e.event === 'video_play' || e.event === 'video_progress');

  await db
    .insert(t.analyticsSessions)
    .values({
      id: first.sessionId,
      visitorId: first.visitorId,
      userId: ctx.userId,
      client: first.client,
      ip: ctx.ip.slice(0, 64),
      deviceType: client.deviceType,
      browser: client.browser,
      os: client.os,
      referrer: referrer?.slice(0, 500) ?? null,
      referrerHost: hostOf(referrer),
      utmSource: utm.utm_source?.slice(0, 120) ?? null,
      utmMedium: utm.utm_medium?.slice(0, 120) ?? null,
      utmCampaign: utm.utm_campaign?.slice(0, 120) ?? null,
      landingPath: landing?.slice(0, 500) ?? null,
      pageviews,
      events: events.length,
    })
    .onConflictDoUpdate({
      target: t.analyticsSessions.id,
      set: {
        userId: sql`coalesce(${t.analyticsSessions.userId}, excluded.user_id)`,
        pageviews: sql`${t.analyticsSessions.pageviews} + ${pageviews}`,
        events: sql`${t.analyticsSessions.events} + ${events.length}`,
        lastSeenAt: new Date(),
        durationSeconds: sql`greatest(0, extract(epoch from (now() - ${t.analyticsSessions.startedAt}))::int)`,
      },
    });

  await db.insert(t.analyticsEvents).values(
    events.map((e) => ({
      sessionId: e.sessionId,
      visitorId: e.visitorId,
      userId: ctx.userId,
      event: e.event,
      path: e.path?.slice(0, 500) ?? null,
      videoId: e.videoId ?? null,
      position: e.position ?? null,
      duration: e.duration ?? null,
      value: e.value ?? null,
      keyword: e.keyword?.slice(0, 200) ?? null,
      client: e.client,
    })),
  );

  await touchOnline(first.sessionId, hasPlay);
}

/** 服务端自身产生的事件（注册、登录、兑换），不经过前端上报。 */
export async function recordAnalyticsServerEvent(input: {
  event: 'signup' | 'login' | 'redeem';
  userId: string;
  value?: number;
}): Promise<void> {
  try {
    await db.insert(t.analyticsEvents).values({
      sessionId: `server:${input.userId.slice(0, 20)}`,
      visitorId: `server:${input.userId.slice(0, 20)}`,
      userId: input.userId,
      event: input.event,
      client: 'pc',
      value: input.value ?? null,
    });
  } catch (error) {
    logger.debug({ err: error }, '服务端埋点写入失败');
  }
}

// --------------------------------------------------------------------------
// 聚合查询
// --------------------------------------------------------------------------

function toPercent(items: { label: string; value: number }[]): BreakdownItem[] {
  const total = items.reduce((sum, i) => sum + i.value, 0) || 1;
  return items.map((i) => ({ ...i, percent: Math.round((i.value / total) * 1000) / 10 }));
}

async function breakdown(column: string, days: number, limit = 8): Promise<BreakdownItem[]> {
  const rows = await sqlRows<{ label: string | null; value: number }>(sql`
    SELECT coalesce(${sql.raw(column)}, '未知') AS label, count(*)::int AS value
    FROM analytics_sessions
    WHERE started_at > now() - (${days} || ' days')::interval
    GROUP BY 1
    ORDER BY value DESC
    LIMIT ${limit}
  `);
  return toPercent(rows.map((r) => ({ label: r.label ?? '未知', value: Number(r.value) })));
}

export async function getTrend(days: number): Promise<TrendPoint[]> {
  const rows = await sqlRows<{
    date: string;
    pageviews: number;
    unique_visitors: number;
    new_users: number;
    video_views: number;
    watch_seconds: number;
    revenue_cents: number;
  }>(sql`
    WITH days AS (
      SELECT to_char(d, 'YYYY-MM-DD') AS date
      FROM generate_series(current_date - (${days - 1} || ' days')::interval, current_date, '1 day') d
    ),
    ev AS (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date,
             count(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
             count(DISTINCT visitor_id)::int AS unique_visitors,
             count(*) FILTER (WHERE event = 'video_play')::int AS video_views,
             coalesce(sum(value) FILTER (WHERE event = 'video_progress'), 0)::bigint AS watch_seconds
      FROM analytics_events
      WHERE created_at > current_date - (${days} || ' days')::interval
      GROUP BY 1
    ),
    us AS (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date, count(*)::int AS new_users
      FROM users WHERE created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ),
    od AS (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date, coalesce(sum(amount_cents), 0)::int AS revenue_cents
      FROM orders WHERE status = 'paid' AND created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    )
    SELECT days.date,
           coalesce(ev.pageviews, 0) AS pageviews,
           coalesce(ev.unique_visitors, 0) AS unique_visitors,
           coalesce(us.new_users, 0) AS new_users,
           coalesce(ev.video_views, 0) AS video_views,
           coalesce(ev.watch_seconds, 0) AS watch_seconds,
           coalesce(od.revenue_cents, 0) AS revenue_cents
    FROM days
    LEFT JOIN ev ON ev.date = days.date
    LEFT JOIN us ON us.date = days.date
    LEFT JOIN od ON od.date = days.date
    ORDER BY days.date
  `);

  return rows.map((r) => ({
    date: r.date,
    pageviews: Number(r.pageviews),
    uniqueVisitors: Number(r.unique_visitors),
    newUsers: Number(r.new_users),
    videoViews: Number(r.video_views),
    watchSeconds: Number(r.watch_seconds),
    revenueCents: Number(r.revenue_cents),
  }));
}

export async function getVisitorInsights(days: number): Promise<VisitorInsights> {
  const [trend, devices, browsers, os, countries, referrers, utmSources] = await Promise.all([
    getTrend(days),
    breakdown('device_type', days),
    breakdown('browser', days),
    breakdown('os', days),
    breakdown('country', days),
    breakdown('referrer_host', days),
    breakdown('utm_source', days),
  ]);

  const topPathRows = await sqlRows<{ label: string; value: number }>(sql`
    SELECT path AS label, count(*)::int AS value
    FROM analytics_events
    WHERE event = 'pageview' AND path IS NOT NULL
      AND created_at > now() - (${days} || ' days')::interval
    GROUP BY 1 ORDER BY value DESC LIMIT 10
  `);

  const keywordRows = await sqlRows<{ label: string; value: number }>(sql`
    SELECT keyword AS label, count(*)::int AS value
    FROM analytics_events
    WHERE event = 'search' AND keyword IS NOT NULL AND keyword <> ''
      AND created_at > now() - (${days} || ' days')::interval
    GROUP BY 1 ORDER BY value DESC LIMIT 10
  `);

  const [summary] = await sqlRows<{
    new_visitors: number;
    returning: number;
    avg_seconds: number;
    bounce: number;
    total: number;
  }>(sql`
    SELECT count(*) FILTER (WHERE is_new_visitor)::int AS new_visitors,
           count(*) FILTER (WHERE NOT is_new_visitor)::int AS returning,
           coalesce(avg(duration_seconds), 0)::int AS avg_seconds,
           count(*) FILTER (WHERE pageviews <= 1)::int AS bounce,
           count(*)::int AS total
    FROM analytics_sessions
    WHERE started_at > now() - (${days} || ' days')::interval
  `);

  const total = Number(summary?.total ?? 0) || 1;

  return {
    trend,
    devices,
    browsers,
    os,
    countries,
    referrers,
    utmSources,
    topPaths: toPercent(topPathRows.map((r) => ({ label: r.label, value: Number(r.value) }))),
    topKeywords: toPercent(keywordRows.map((r) => ({ label: r.label, value: Number(r.value) }))),
    newVsReturning: {
      newVisitors: Number(summary?.new_visitors ?? 0),
      returning: Number(summary?.returning ?? 0),
    },
    avgSessionSeconds: Number(summary?.avg_seconds ?? 0),
    bounceRate: Math.round((Number(summary?.bounce ?? 0) / total) * 1000) / 10,
  };
}

/** 单视频留存曲线：把播放进度分成 20 段统计触达人数。 */
export async function getVideoRetention(videoId: string) {
  const rows = await sqlRows<{ bucket: number; viewers: number }>(sql`
    WITH b AS (
      SELECT least(19, floor((position / nullif(duration, 0)) * 20))::int AS bucket,
             count(DISTINCT coalesce(user_id::text, visitor_id)) AS viewers
      FROM analytics_events
      WHERE video_id = ${videoId} AND event IN ('video_progress', 'video_complete')
        AND duration > 0 AND position >= 0
      GROUP BY 1
    )
    SELECT g.bucket, coalesce(b.viewers, 0)::int AS viewers
    FROM generate_series(0, 19) g(bucket)
    LEFT JOIN b ON b.bucket = g.bucket
    ORDER BY g.bucket
  `);

  const peak = Math.max(1, ...rows.map((r) => Number(r.viewers)));
  return rows.map((r) => ({
    bucket: Number(r.bucket) * 5,
    percentOfViewers: Math.round((Number(r.viewers) / peak) * 1000) / 10,
  }));
}
