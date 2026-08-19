import { sql } from 'drizzle-orm';
import type { AlgoWeights, VideoSummary } from '@videox/shared';
import { db, t, sqlRows, uuidArray } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { getAlgoWeights } from '../settings/service.js';
import { getSummariesByIds } from '../videos/service.js';
import { SOURCE_LABELS, applyExploration, buildCandidates, mmrRerank, type RecallRow } from './scoring.js';

/** 各类行为对兴趣画像的贡献权重。完播和收藏是最强信号。 */
const BEHAVIOR_WEIGHTS = {
  view: 1,
  complete: 4,
  like: 3,
  favorite: 5,
  follow: 2,
  comment: 2,
} as const;

export type BehaviorKind = keyof typeof BEHAVIOR_WEIGHTS;

/**
 * 记录一次用户行为，把权重摊到这条视频的所有标签与分类上。
 * 使用 upsert 累加，配合每日衰减任务实现「近期兴趣更重要」。
 */
export async function recordBehavior(userId: string, videoId: string, kind: BehaviorKind): Promise<void> {
  const weight = BEHAVIOR_WEIGHTS[kind];
  try {
    await sqlRows(sql`
      INSERT INTO user_tag_affinity (user_id, tag_id, score, updated_at)
      SELECT ${userId}::uuid, vt.tag_id, ${weight}, now()
      FROM video_tags vt WHERE vt.video_id = ${videoId}::uuid
      ON CONFLICT (user_id, tag_id)
      DO UPDATE SET score = user_tag_affinity.score + ${weight}, updated_at = now()
    `);

    await sqlRows(sql`
      INSERT INTO user_category_affinity (user_id, category_id, score, updated_at)
      SELECT ${userId}::uuid, v.category_id, ${weight}, now()
      FROM videos v WHERE v.id = ${videoId}::uuid AND v.category_id IS NOT NULL
      ON CONFLICT (user_id, category_id)
      DO UPDATE SET score = user_category_affinity.score + ${weight}, updated_at = now()
    `);
  } catch (error) {
    logger.debug({ err: error, userId, videoId, kind }, '兴趣画像更新失败');
  }
}

/** 曝光记录：用于降权已经反复出现却没被点击的内容。 */
export async function recordImpressions(userId: string, videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  try {
    await sqlRows(sql`
      INSERT INTO recommendation_impressions (user_id, video_id, count, last_shown_at)
      SELECT ${userId}::uuid, unnest(${uuidArray(videoIds)}), 1, now()
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET count = recommendation_impressions.count + 1, last_shown_at = now()
    `);
  } catch (error) {
    logger.debug({ err: error }, '曝光记录写入失败');
  }
}

/**
 * 兴趣衰减。每天跑一次，按半衰期把历史分数打折，
 * 这样一个月前的偏好不会永远压制新兴趣。
 */
export async function decayAffinity(halfLifeDays: number): Promise<void> {
  const factor = Math.pow(0.5, 1 / Math.max(1, halfLifeDays));
  await sqlRows(sql`UPDATE user_tag_affinity SET score = score * ${factor} WHERE score > 0.01`);
  await sqlRows(sql`UPDATE user_category_affinity SET score = score * ${factor} WHERE score > 0.01`);
  await sqlRows(sql`DELETE FROM user_tag_affinity WHERE score <= 0.01`);
  await sqlRows(sql`DELETE FROM user_category_affinity WHERE score <= 0.01`);
  await sqlRows(sql`DELETE FROM recommendation_impressions WHERE last_shown_at < now() - interval '30 days'`);
}

/**
 * 多路召回。一次 SQL 里用 UNION 合并四条通路：
 *  1. 兴趣命中（用户标签/分类画像）
 *  2. 全站热门
 *  3. 新鲜内容
 *  4. 协同过滤（看过相同视频的人还看了什么）
 * 这样避免多次往返，也让候选集天然带上来源标记。
 */
async function recall(userId: string | null, excludeIds: string[], limit: number): Promise<RecallRow[]> {
  const poolSize = Math.max(limit * 6, 120);

  if (!userId) {
    // 游客只走热门 + 新鲜两路。
    return sqlRows<RecallRow>(sql`
      SELECT v.id, v.category_id, v.author_id,
             array(SELECT tag_id::text FROM video_tags WHERE video_id = v.id) AS tag_ids,
             0::float8 AS affinity,
             v.quality_score,
             extract(epoch FROM (now() - coalesce(v.published_at, v.created_at))) / 86400 AS age_days,
             v.completion_rate, v.view_count, v.ai_score, v.manual_boost,
             0::int AS impressions,
             'anonymous' AS source
      FROM videos v
      WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
        AND (v.published_at IS NULL OR v.published_at <= now())
        AND coalesce(v.kind,'vod') = 'vod'
        AND NOT (v.id = ANY(${uuidArray(excludeIds)}))
      ORDER BY (v.view_count + v.like_count * 5)
               / power(extract(epoch FROM (now() - coalesce(v.published_at, v.created_at))) / 3600 + 2, 1.2) DESC
      LIMIT ${poolSize}
    `);
  }

  return sqlRows<RecallRow>(sql`
    WITH base AS (
      SELECT v.id, v.category_id, v.author_id, v.quality_score, v.completion_rate,
             v.view_count, v.like_count, v.ai_score, v.manual_boost,
             coalesce(v.published_at, v.created_at) AS pub
      FROM videos v
      WHERE v.status IN ('ready','partially_ready') AND v.visibility = 'public'
        AND (v.published_at IS NULL OR v.published_at <= now())
        AND coalesce(v.kind,'vod') = 'vod'
        AND NOT (v.id = ANY(${uuidArray(excludeIds)}))
    ),
    tag_hits AS (
      SELECT b.id, sum(uta.score) AS affinity, 'tag' AS source
      FROM base b
      JOIN video_tags vt ON vt.video_id = b.id
      JOIN user_tag_affinity uta ON uta.tag_id = vt.tag_id AND uta.user_id = ${userId}::uuid
      GROUP BY b.id
      ORDER BY affinity DESC
      LIMIT ${poolSize}
    ),
    cat_hits AS (
      SELECT b.id, uca.score AS affinity, 'category' AS source
      FROM base b
      JOIN user_category_affinity uca ON uca.category_id = b.category_id AND uca.user_id = ${userId}::uuid
      ORDER BY uca.score DESC
      LIMIT ${Math.floor(poolSize / 2)}
    ),
    hot AS (
      SELECT b.id, 0::float8 AS affinity, 'hot' AS source
      FROM base b
      ORDER BY (b.view_count + b.like_count * 5)
               / power(extract(epoch FROM (now() - b.pub)) / 3600 + 2, 1.2) DESC
      LIMIT ${Math.floor(poolSize / 2)}
    ),
    fresh AS (
      SELECT b.id, 0::float8 AS affinity, 'fresh' AS source
      FROM base b
      WHERE b.pub > now() - interval '14 days'
      ORDER BY b.pub DESC
      LIMIT ${Math.floor(poolSize / 3)}
    ),
    collab AS (
      -- 与我看过同一批视频的其他用户，他们还看了什么
      SELECT b.id, count(*)::float8 * 2 AS affinity, 'collab' AS source
      FROM watch_history peer
      JOIN base b ON b.id = peer.video_id
      WHERE peer.user_id IN (
        SELECT DISTINCT w2.user_id
        FROM watch_history w1
        JOIN watch_history w2 ON w2.video_id = w1.video_id AND w2.user_id <> w1.user_id
        WHERE w1.user_id = ${userId}::uuid
        LIMIT 200
      )
      AND b.id NOT IN (SELECT video_id FROM watch_history WHERE user_id = ${userId}::uuid)
      GROUP BY b.id
      ORDER BY affinity DESC
      LIMIT ${Math.floor(poolSize / 3)}
    ),
    merged AS (
      SELECT * FROM tag_hits
      UNION ALL SELECT * FROM cat_hits
      UNION ALL SELECT * FROM hot
      UNION ALL SELECT * FROM fresh
      UNION ALL SELECT * FROM collab
    ),
    deduped AS (
      SELECT id, sum(affinity) AS affinity, min(source) AS source
      FROM merged GROUP BY id
    )
    SELECT d.id, b.category_id, b.author_id,
           array(SELECT tag_id::text FROM video_tags WHERE video_id = d.id) AS tag_ids,
           d.affinity,
           b.quality_score,
           extract(epoch FROM (now() - b.pub)) / 86400 AS age_days,
           b.completion_rate, b.view_count, b.ai_score, b.manual_boost,
           coalesce(ri.count, 0)::int AS impressions,
           d.source
    FROM deduped d
    JOIN base b ON b.id = d.id
    LEFT JOIN recommendation_impressions ri ON ri.user_id = ${userId}::uuid AND ri.video_id = d.id
    -- 已经看过的不再推
    WHERE d.id NOT IN (SELECT video_id FROM watch_history WHERE user_id = ${userId}::uuid AND completed = true)
    LIMIT ${poolSize}
  `);
}

export interface RecommendOptions {
  userId: string | null;
  limit: number;
  excludeIds?: string[];
  /** 竖屏沉浸流会要求更强的多样性 */
  boostDiversity?: boolean;
}

export async function recommendVideos(options: RecommendOptions): Promise<VideoSummary[]> {
  const weights = await getAlgoWeights();
  const effectiveWeights: AlgoWeights = options.boostDiversity
    ? { ...weights, diversityLambda: Math.min(0.6, weights.diversityLambda * 2) }
    : weights;

  const rows = await recall(options.userId, options.excludeIds ?? [], options.limit);
  if (rows.length === 0) return [];

  const candidates = buildCandidates(rows, effectiveWeights);
  const reranked = applyExploration(
    mmrRerank(candidates, effectiveWeights, options.limit),
    candidates,
    effectiveWeights.explorationRatio,
  );

  const ids = reranked.map((c) => c.id);
  const summaries = await getSummariesByIds(ids);
  const reasonById = new Map(reranked.map((c) => [c.id, SOURCE_LABELS[c.source] ?? null]));

  return summaries.map((s) => ({ ...s, recommendReason: reasonById.get(s.id) ?? null }));
}

/**
 * 刷新视频质量分与完播率。定时任务调用。
 * 质量分 = 互动率的加权归一化，避免单纯用播放量导致马太效应。
 */
export async function refreshVideoQuality(): Promise<void> {
  await sqlRows(sql`
    UPDATE videos v SET
      completion_rate = CASE
        WHEN v.view_count > 0 AND v.duration_seconds > 0
        THEN least(1.0, (v.total_watch_seconds::float8 / v.view_count) / v.duration_seconds)
        ELSE 0 END,
      quality_score = least(1.0,
          (v.like_count::float8 / greatest(v.view_count, 1)) * 8
        + (v.favorite_count::float8 / greatest(v.view_count, 1)) * 12
        + (v.comment_count::float8 / greatest(v.view_count, 1)) * 20
      )
    WHERE v.status IN ('ready','partially_ready')
  `);
}
