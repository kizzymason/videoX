import { desc, eq, sql } from 'drizzle-orm';
import type { VideoSummary } from '@videox/shared';
import { db, t, sqlRows } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { recommendVideos } from '../recommend/service.js';
import { getSummariesByIds, listVideos } from '../videos/service.js';
import { settleRecommend } from './fallback.js';

const RAIL_SIZE = 24;
const CATEGORY_RAIL_SIZE = 8;
const CATEGORY_RAILS = 6;

interface CatalogHomeRail {
  category: { id: string; slug: string; name: string };
  items: VideoSummary[];
}

interface CatalogHome {
  recommend: VideoSummary[];
  latest: VideoSummary[];
  hot7d: VideoSummary[];
  categories: CatalogHomeRail[];
  /** recommend 抛错时为 true，其它栏仍会返回 */
  degraded: boolean;
}

export async function getCatalogHome(options: { userId: string | null }): Promise<CatalogHome> {
  const [rec, latestPage, hotRows, categoryRows] = await Promise.all([
    settleRecommend(() => recommendVideos({ userId: options.userId, limit: RAIL_SIZE })),
    listVideos({ page: 1, pageSize: RAIL_SIZE, sort: 'latest' }),
    sqlRows<{ id: string }>(sql`
      SELECT v.id
      FROM videos v
      WHERE v.status IN ('ready','partially_ready')
        AND v.visibility = 'public'
        AND (v.published_at IS NULL OR v.published_at <= now())
        AND coalesce(v.published_at, v.created_at) > now() - interval '7 days'
      ORDER BY v.view_count DESC, v.like_count DESC, coalesce(v.published_at, v.created_at) DESC
      LIMIT ${RAIL_SIZE}
    `),
    db
      .select({
        id: t.categories.id,
        slug: t.categories.slug,
        name: t.categories.name,
      })
      .from(t.categories)
      .where(eq(t.categories.isActive, true))
      .orderBy(t.categories.sortOrder, desc(t.categories.videoCount))
      .limit(CATEGORY_RAILS),
  ]);

  if (rec.degraded) {
    logger.warn('推荐挂了，发现页走 latest / 7 日热门 / 分类精选兜底');
  }

  const hot7d = await getSummariesByIds(hotRows.map((row) => row.id));

  const categories: CatalogHomeRail[] = [];
  for (const category of categoryRows) {
    const page = await listVideos({
      page: 1,
      pageSize: CATEGORY_RAIL_SIZE,
      categoryId: category.id,
      sort: 'popular',
    });
    if (page.items.length === 0) continue;
    categories.push({
      category: { id: category.id, slug: category.slug, name: category.name },
      items: page.items,
    });
  }

  return {
    recommend: rec.items,
    latest: latestPage.items,
    hot7d,
    categories,
    degraded: rec.degraded,
  };
}
