import { and, eq, inArray, like, sql } from 'drizzle-orm';
import {
  CLEAR_FAILED_JOBS_MAX,
  RETRY_FAILED_JOBS_MAX,
  groupDuplicateRows,
  normalizeDedupeTitle,
  pickCollectedDedupeWinner,
  type CollectedDedupeCandidate,
} from '@videox/shared';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { cleanFailedQueueJobs, enqueueCollectionJob, removeQueueJob, type CollectionJobType } from './queues/tasks.js';

const TARGET_SITE = 'yitongkan';

export async function countFailedCollectionJobs(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t.collectionJobs)
    .where(and(eq(t.collectionJobs.targetSite, TARGET_SITE), eq(t.collectionJobs.status, 'failed')));
  return Number(row?.total ?? 0);
}

export async function clearFailedCollectionJobs(): Promise<{ deleted: number; queueCleaned: number }> {
  const failed = await db
    .select({ id: t.collectionJobs.id, taskId: t.collectionJobs.taskId })
    .from(t.collectionJobs)
    .where(and(eq(t.collectionJobs.targetSite, TARGET_SITE), eq(t.collectionJobs.status, 'failed')))
    .limit(CLEAR_FAILED_JOBS_MAX);

  if (failed.length === 0) return { deleted: 0, queueCleaned: 0 };

  for (const job of failed) {
    await removeQueueJob(job.taskId);
  }

  await db.delete(t.collectionJobs).where(
    inArray(
      t.collectionJobs.id,
      failed.map((job) => job.id),
    ),
  );
  const queueCleaned = await cleanFailedQueueJobs();
  logger.info({ deleted: failed.length, queueCleaned }, '已清除失败采集任务');
  return { deleted: failed.length, queueCleaned };
}

export async function retryFailedCollectionJobs(): Promise<{ retried: number; remaining: number }> {
  const failed = await db
    .select()
    .from(t.collectionJobs)
    .where(and(eq(t.collectionJobs.targetSite, TARGET_SITE), eq(t.collectionJobs.status, 'failed')))
    .orderBy(t.collectionJobs.createdAt)
    .limit(RETRY_FAILED_JOBS_MAX);

  let retried = 0;
  for (const job of failed) {
    await removeQueueJob(job.taskId);
    await enqueueCollectionJob({
      taskId: job.taskId,
      type: job.type as CollectionJobType,
      payload: job.payload ?? {},
      priority: 200,
    });
    retried += 1;
  }

  const remaining = await countFailedCollectionJobs();
  logger.info({ retried, remaining }, '已重试失败采集任务');
  return { retried, remaining };
}

type CollectedRow = CollectedDedupeCandidate & { targetSite: string };

export async function dedupeCollectedLibrary(): Promise<{
  scanned: number;
  duplicateGroups: number;
  removedCollected: number;
  archivedCollected: number;
  hiddenVideos: number;
  samples: Array<{ key: string; keptTitle: string; dropped: number }>;
}> {
  const rows = (await db.select().from(t.collectedVideos).where(eq(t.collectedVideos.targetSite, TARGET_SITE))) as CollectedRow[];
  const dropIds = new Set<string>();
  const samples: Array<{ key: string; keptTitle: string; dropped: number }> = [];

  const applyGroups = (groups: CollectedRow[][], keyPrefix: string) => {
    for (const group of groups) {
      const alive = group.filter((row) => !dropIds.has(row.id));
      if (alive.length < 2) continue;
      const { keep, drop } = pickCollectedDedupeWinner(alive);
      for (const row of drop) dropIds.add(row.id);
      samples.push({
        key: `${keyPrefix}:${keep.externalId}`,
        keptTitle: keep.title,
        dropped: drop.length,
      });
    }
  };

  applyGroups(
    groupDuplicateRows(rows, (row) => `${row.targetSite}:${row.externalId}`),
    'id',
  );
  applyGroups(
    groupDuplicateRows(
      rows.filter((row) => row.status !== 'archived' && !dropIds.has(row.id)),
      (row) => {
        const title = normalizeDedupeTitle(row.title);
        return title ? `${row.targetSite}:${row.kind}:${title}` : null;
      },
    ),
    'title',
  );

  let removedCollected = 0;
  let archivedCollected = 0;
  const hideVideoIds: string[] = [];

  for (const row of rows) {
    if (!dropIds.has(row.id)) continue;
    if (row.status === 'pending' && !row.videoId) {
      await db.delete(t.collectedVideos).where(eq(t.collectedVideos.id, row.id));
      removedCollected += 1;
      continue;
    }
    await db
      .update(t.collectedVideos)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(t.collectedVideos.id, row.id));
    archivedCollected += 1;
    if (row.videoId) hideVideoIds.push(row.videoId);
  }

  const keepVideoIds = new Set(
    rows.filter((row) => !dropIds.has(row.id) && row.videoId).map((row) => row.videoId!),
  );
  const collectionVideos = await db
    .select({
      id: t.videos.id,
      title: t.videos.title,
      viewCount: t.videos.viewCount,
      hlsDir: t.videos.hlsDir,
      createdAt: t.videos.createdAt,
    })
    .from(t.videos)
    .where(like(t.videos.hlsDir, 'collected/%'));

  const videoGroups = groupDuplicateRows(collectionVideos, (video) => {
    const title = normalizeDedupeTitle(video.title);
    return title ? `video-title:${title}` : null;
  });
  for (const group of videoGroups) {
    const sorted = [...group].sort((a, b) => {
      const keepA = keepVideoIds.has(a.id) ? 1 : 0;
      const keepB = keepVideoIds.has(b.id) ? 1 : 0;
      if (keepA !== keepB) return keepB - keepA;
      if ((b.viewCount ?? 0) !== (a.viewCount ?? 0)) return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    for (const extra of sorted.slice(1)) {
      if (!hideVideoIds.includes(extra.id) && !keepVideoIds.has(extra.id)) {
        hideVideoIds.push(extra.id);
      }
    }
  }

  const uniqueHide = [...new Set(hideVideoIds)].filter((id) => !keepVideoIds.has(id));
  if (uniqueHide.length > 0) {
    await db
      .update(t.videos)
      .set({ visibility: 'private', status: 'archived', updatedAt: new Date() })
      .where(inArray(t.videos.id, uniqueHide));
  }

  logger.info(
    {
      scanned: rows.length,
      duplicateGroups: samples.length,
      removedCollected,
      archivedCollected,
      hiddenVideos: uniqueHide.length,
    },
    '采集库去重完成',
  );

  return {
    scanned: rows.length,
    duplicateGroups: samples.length,
    removedCollected,
    archivedCollected,
    hiddenVideos: uniqueHide.length,
    samples: samples.slice(0, 20),
  };
}
