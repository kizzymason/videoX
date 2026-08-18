import { sql } from 'drizzle-orm';
import type { DashboardOverview } from '@videox/shared';
import { db, sqlRows } from '../../core/db.js';
import { getRealtimeStats } from '../analytics/service.js';
import { getStorageUsage } from '../storage/service.js';

/**
 * 仪表盘概览。所有计数走一条 SQL，避免十几次往返；
 * deltas 是「最近 7 天」与「上一个 7 天」的环比增幅（百分比）。
 */
export async function getDashboardOverview(): Promise<DashboardOverview> {
  const [totals] = await sqlRows<{
    users: number;
    videos: number;
    views: number;
    comments: number;
    vip_users: number;
    revenue_cents: number;
    watch_seconds: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM videos WHERE status <> 'archived') AS videos,
      (SELECT coalesce(sum(view_count), 0)::bigint FROM videos) AS views,
      (SELECT count(*)::int FROM comments WHERE status = 'visible') AS comments,
      (SELECT count(*)::int FROM users WHERE vip_expires_at > now()) AS vip_users,
      (SELECT coalesce(sum(amount_cents), 0)::bigint FROM orders WHERE status = 'paid') AS revenue_cents,
      (SELECT coalesce(sum(total_watch_seconds), 0)::bigint FROM videos) AS watch_seconds
  `);

  const [deltas] = await sqlRows<{
    users_now: number;
    users_prev: number;
    views_now: number;
    views_prev: number;
    revenue_now: number;
    revenue_prev: number;
    watch_now: number;
    watch_prev: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_now,
      (SELECT count(*)::int FROM users WHERE created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days') AS users_prev,
      (SELECT count(*)::int FROM analytics_events WHERE event = 'video_play' AND created_at > now() - interval '7 days') AS views_now,
      (SELECT count(*)::int FROM analytics_events WHERE event = 'video_play' AND created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days') AS views_prev,
      (SELECT coalesce(sum(amount_cents), 0)::int FROM orders WHERE status = 'paid' AND created_at > now() - interval '7 days') AS revenue_now,
      (SELECT coalesce(sum(amount_cents), 0)::int FROM orders WHERE status = 'paid' AND created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days') AS revenue_prev,
      (SELECT coalesce(sum(value), 0)::bigint FROM analytics_events WHERE event = 'video_progress' AND created_at > now() - interval '7 days') AS watch_now,
      (SELECT coalesce(sum(value), 0)::bigint FROM analytics_events WHERE event = 'video_progress' AND created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days') AS watch_prev
  `);

  const [realtime, storageBytes] = await Promise.all([getRealtimeStats(), getStorageUsage()]);

  // 上期为 0 时不做除法，直接按「有增量就是 100%」处理，避免出现 Infinity。
  const pct = (now: number, prev: number): number => {
    if (prev === 0) return now > 0 ? 100 : 0;
    return Math.round(((now - prev) / prev) * 1000) / 10;
  };

  return {
    totals: {
      users: Number(totals?.users ?? 0),
      videos: Number(totals?.videos ?? 0),
      views: Number(totals?.views ?? 0),
      comments: Number(totals?.comments ?? 0),
      vipUsers: Number(totals?.vip_users ?? 0),
      revenueCents: Number(totals?.revenue_cents ?? 0),
      storageBytes,
      watchSeconds: Number(totals?.watch_seconds ?? 0),
    },
    deltas: {
      users: pct(Number(deltas?.users_now ?? 0), Number(deltas?.users_prev ?? 0)),
      views: pct(Number(deltas?.views_now ?? 0), Number(deltas?.views_prev ?? 0)),
      revenueCents: pct(Number(deltas?.revenue_now ?? 0), Number(deltas?.revenue_prev ?? 0)),
      watchSeconds: pct(Number(deltas?.watch_now ?? 0), Number(deltas?.watch_prev ?? 0)),
    },
    realtime,
  };
}

/** 热门视频榜，仪表盘右侧列表。 */
export async function getTopVideos(days: number, limit = 10) {
  const rows = await sqlRows<{
    id: string;
    title: string;
    poster_url: string | null;
    plays: number;
    watch_seconds: number;
    completion_rate: number;
  }>(sql`
    SELECT v.id, v.title, v.poster_url,
           count(*) FILTER (WHERE e.event = 'video_play')::int AS plays,
           coalesce(sum(e.value) FILTER (WHERE e.event = 'video_progress'), 0)::bigint AS watch_seconds,
           v.completion_rate
    FROM videos v
    LEFT JOIN analytics_events e ON e.video_id = v.id AND e.created_at > now() - (${days} || ' days')::interval
    WHERE v.status IN ('ready','partially_ready')
    GROUP BY v.id
    ORDER BY plays DESC, v.view_count DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    posterUrl: r.poster_url,
    plays: Number(r.plays),
    watchSeconds: Number(r.watch_seconds),
    completionRate: Math.round(Number(r.completion_rate) * 1000) / 10,
  }));
}

/**
 * 把原始埋点聚合进 stats_daily / stats_video_daily。
 * 仪表盘的趋势图优先读聚合表，原始表只保留近期明细。
 */
export async function aggregateDailyStats(days = 3): Promise<void> {
  await sqlRows(sql`
    INSERT INTO stats_daily (date, pageviews, unique_visitors, sessions, new_users, video_views, watch_seconds, comments, revenue_cents, new_vips, bounce_sessions, total_session_seconds, updated_at)
    SELECT d.date,
      coalesce(e.pageviews, 0), coalesce(e.uniq, 0), coalesce(s.sessions, 0),
      coalesce(u.new_users, 0), coalesce(e.plays, 0), coalesce(e.watch_seconds, 0),
      coalesce(c.comments, 0), coalesce(o.revenue, 0), coalesce(o.new_vips, 0),
      coalesce(s.bounce, 0), coalesce(s.total_seconds, 0), now()
    FROM (
      SELECT to_char(gs, 'YYYY-MM-DD') AS date
      FROM generate_series(current_date - (${days} || ' days')::interval, current_date, '1 day') gs
    ) d
    LEFT JOIN (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date,
             count(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
             count(DISTINCT visitor_id)::int AS uniq,
             count(*) FILTER (WHERE event = 'video_play')::int AS plays,
             coalesce(sum(value) FILTER (WHERE event = 'video_progress'), 0)::bigint AS watch_seconds
      FROM analytics_events WHERE created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ) e ON e.date = d.date
    LEFT JOIN (
      SELECT to_char(started_at, 'YYYY-MM-DD') AS date, count(*)::int AS sessions,
             count(*) FILTER (WHERE pageviews <= 1)::int AS bounce,
             coalesce(sum(duration_seconds), 0)::bigint AS total_seconds
      FROM analytics_sessions WHERE started_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ) s ON s.date = d.date
    LEFT JOIN (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date, count(*)::int AS new_users
      FROM users WHERE created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ) u ON u.date = d.date
    LEFT JOIN (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date, count(*)::int AS comments
      FROM comments WHERE created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ) c ON c.date = d.date
    LEFT JOIN (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS date,
             coalesce(sum(amount_cents), 0)::int AS revenue,
             count(*)::int AS new_vips
      FROM orders WHERE status = 'paid' AND created_at > current_date - (${days} || ' days')::interval GROUP BY 1
    ) o ON o.date = d.date
    ON CONFLICT (date) DO UPDATE SET
      pageviews = excluded.pageviews, unique_visitors = excluded.unique_visitors,
      sessions = excluded.sessions, new_users = excluded.new_users,
      video_views = excluded.video_views, watch_seconds = excluded.watch_seconds,
      comments = excluded.comments, revenue_cents = excluded.revenue_cents,
      new_vips = excluded.new_vips, bounce_sessions = excluded.bounce_sessions,
      total_session_seconds = excluded.total_session_seconds, updated_at = now()
  `);

  await sqlRows(sql`
    INSERT INTO stats_video_daily (date, video_id, impressions, clicks, plays, completes, watch_seconds, likes, comments, updated_at)
    SELECT to_char(created_at, 'YYYY-MM-DD') AS date, video_id,
           count(*) FILTER (WHERE event = 'video_impression')::int,
           count(*) FILTER (WHERE event = 'video_click')::int,
           count(*) FILTER (WHERE event = 'video_play')::int,
           count(*) FILTER (WHERE event = 'video_complete')::int,
           coalesce(sum(value) FILTER (WHERE event = 'video_progress'), 0)::bigint,
           0, 0, now()
    FROM analytics_events
    WHERE video_id IS NOT NULL AND created_at > current_date - (${days} || ' days')::interval
    GROUP BY 1, 2
    ON CONFLICT (date, video_id) DO UPDATE SET
      impressions = excluded.impressions, clicks = excluded.clicks,
      plays = excluded.plays, completes = excluded.completes,
      watch_seconds = excluded.watch_seconds, updated_at = now()
  `);
}
