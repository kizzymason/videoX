// ========================================================================
// 采集系统 - 自动导入
// 由调度器按配置的间隔轮询：把采集到的 pending 记录自动入库并发布
// ========================================================================

import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, sql } from 'drizzle-orm';
import { AUTO_IMPORT_BATCH_MAX, type CollectionAutoImportConfig } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { getAutoImportConfig } from './storage/config.js';
import { importPendingVideos } from './storage/import.js';

const TARGET_SITE = 'yitongkan';

export interface AutoImportRunResult {
  skipped?: 'disabled' | 'no-operator' | 'empty';
  imported: number;
  failed: number;
  /** 本轮判定失效、后续不再重试的条数 */
  givenUp: number;
  remaining: number;
  batches: number;
  durationMs: number;
}

/**
 * 自动导入用哪个账号当视频作者。
 *
 * 先沿用上一次采集入库的作者，保证前台「作者」不会因为换人操作而分裂；
 * 找不到就取最早创建的管理员。一个管理员都没有时返回 null，本轮直接跳过。
 */
async function resolveImportOperatorId(): Promise<string | null> {
  const [lastCollected] = await db
    .select({ authorId: t.videos.authorId })
    .from(t.videos)
    .where(like(t.videos.hlsDir, 'collected/%'))
    .orderBy(desc(t.videos.createdAt))
    .limit(1);
  if (lastCollected?.authorId) return lastCollected.authorId;

  const [admin] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(and(eq(t.users.role, 'admin'), eq(t.users.status, 'active')))
    .orderBy(asc(t.users.createdAt))
    .limit(1);
  return admin?.id ?? null;
}

/** 还能重试的待导入条数（判定失效的不算）。 */
export async function countImportablePending(maxAttempts: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t.collectedVideos)
    .where(
      and(
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        eq(t.collectedVideos.status, 'pending'),
        lt(t.collectedVideos.importAttempts, maxAttempts),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * 跑一轮自动导入。
 *
 * 一轮最多跑 maxBatches 批：留出余量给转码 / 热链这些同样吃 CPU 的活，
 * 剩下的等下一个间隔继续，不至于一次把机器压满。
 */
export async function runAutoImport(options: { maxBatches?: number } = {}): Promise<AutoImportRunResult> {
  const started = Date.now();
  const config = await getAutoImportConfig();
  const empty: AutoImportRunResult = {
    imported: 0,
    failed: 0,
    givenUp: 0,
    remaining: 0,
    batches: 0,
    durationMs: 0,
  };

  if (!config.enabled) return { ...empty, skipped: 'disabled', durationMs: Date.now() - started };

  const pending = await countImportablePending(config.maxAttempts);
  if (pending === 0) return { ...empty, skipped: 'empty', durationMs: Date.now() - started };

  const userId = await resolveImportOperatorId();
  if (!userId) {
    logger.warn('自动导入找不到可用的管理员账号，本轮跳过');
    return { ...empty, skipped: 'no-operator', remaining: pending, durationMs: Date.now() - started };
  }

  const maxBatches = Math.max(1, options.maxBatches ?? 6);
  const batchSize = Math.min(AUTO_IMPORT_BATCH_MAX, config.batchSize);
  let imported = 0;
  let failed = 0;
  let givenUp = 0;
  let remaining = pending;
  let batches = 0;

  for (let i = 0; i < maxBatches && remaining > 0; i += 1) {
    const result = await importPendingVideos({
      userId,
      autoPublish: config.autoPublish,
      forceMode: config.forceMode === 'auto' ? undefined : config.forceMode,
      batchSize,
      maxAttempts: config.maxAttempts,
    });
    batches += 1;
    imported += result.imported.length;
    failed += result.failed.length;
    givenUp += result.givenUp;
    remaining = result.remaining;
    if (result.processed === 0) break;
    // 一整批全失败且没有任何一条被判失效，说明源站或号池整体不可用，
    // 继续刷下去只会白烧重试次数，留给下一个间隔。
    if (result.imported.length === 0 && result.givenUp === 0) break;
  }

  const durationMs = Date.now() - started;
  logger.info({ imported, failed, givenUp, remaining, batches, durationMs }, '自动导入完成');
  return { imported, failed, givenUp, remaining, batches, durationMs };
}

/**
 * 把采集库里的真实时长同步到正式视频表。
 *
 * 早期源站列表的时长字段读错了名字（源站叫 durationSeconds，代码读的 duration），
 * 导致 5 万多条入库时长都是 0。字段修好后，采集记录的 metadata 会陆续拿到真实值，
 * 这里负责把值搬到 videos.duration_seconds —— 纯 SQL 批量更新，不额外请求源站。
 * 只在「采集库有正数、正式表还是 0 或不一致」时才写，重复执行无副作用。
 */
export async function syncVideoDurations(): Promise<{ updated: number; pending: number }> {
  const updated = await db.execute(sql`
    UPDATE videos v
    SET duration_seconds = src.duration, updated_at = now()
    FROM (
      SELECT cv.video_id, (cv.metadata->>'duration')::int AS duration
      FROM collected_videos cv
      WHERE cv.video_id IS NOT NULL
        AND cv.metadata->>'duration' ~ '^[0-9]+$'
        AND (cv.metadata->>'duration')::int > 0
    ) src
    WHERE v.id = src.video_id AND v.duration_seconds <> src.duration
  `);

  // 还没拿到真实时长的已入库视频数：全量抓一轮列表就会补上。
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t.videos)
    .where(and(like(t.videos.hlsDir, 'collected/%'), sql`${t.videos.durationSeconds} <= 0`));

  const result = {
    updated: (updated as unknown as { rowCount?: number }).rowCount ?? 0,
    pending: Number(row?.total ?? 0),
  };
  if (result.updated > 0) logger.info(result, '视频时长已从采集库同步');
  return result;
}

export interface CollectedCleanupResult {
  /** 重试次数已到上限但状态还停在 pending 的，补一刀置为失效 */
  markedFailed: number;
  /** 关联视频已被删除的采集记录，归档掉（不重新导入，删除通常是管理员的本意） */
  archivedOrphans: number;
  /** 有 videoId 却还停在 pending/failed 的，状态补成已导入 */
  fixedImported: number;
}

/**
 * 清理卡住的采集记录。跟去重分开：这里只处理「状态和事实不一致」以及
 * 「重试到头还占着队列」的记录，不做标题比对。
 */
export async function cleanupStuckCollected(
  config?: CollectionAutoImportConfig,
): Promise<CollectedCleanupResult> {
  const { maxAttempts } = config ?? (await getAutoImportConfig());

  const markedFailed = await db
    .update(t.collectedVideos)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(
      and(
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        eq(t.collectedVideos.status, 'pending'),
        isNull(t.collectedVideos.videoId),
        sql`${t.collectedVideos.importAttempts} >= ${maxAttempts}`,
      ),
    )
    .returning({ id: t.collectedVideos.id });

  // videoId 指向的视频被删了：FK 是 set null，所以这里表现为 imported 却没有 videoId。
  // 归档而不是退回 pending —— 视频被删一般是管理员的本意，自动再导一遍等于跟人对着干。
  const archivedOrphans = await db
    .update(t.collectedVideos)
    .set({ status: 'archived', importMode: null, importedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        eq(t.collectedVideos.status, 'imported'),
        isNull(t.collectedVideos.videoId),
      ),
    )
    .returning({ id: t.collectedVideos.id });

  // 有 videoId 说明视频确实进了正式库，状态却还是 pending/failed：把账对上，别重复导入。
  // archived 不动，那是「已下架归档」的正常状态。
  const fixedImported = await db
    .update(t.collectedVideos)
    .set({ status: 'imported', importError: null, updatedAt: new Date() })
    .where(
      and(
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        isNotNull(t.collectedVideos.videoId),
        inArray(t.collectedVideos.status, ['pending', 'failed']),
      ),
    )
    .returning({ id: t.collectedVideos.id });

  const result = {
    markedFailed: markedFailed.length,
    archivedOrphans: archivedOrphans.length,
    fixedImported: fixedImported.length,
  };
  if (result.markedFailed + result.archivedOrphans + result.fixedImported > 0) {
    logger.info(result, '采集记录状态清理完成');
  }
  return result;
}
