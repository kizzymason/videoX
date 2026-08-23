import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { invalidateMediaCache } from '../media/routes.js';
import { getStorage } from '../storage/service.js';
import { refreshCategoryCounts } from '../videos/service.js';
import { removeQueueJob } from './queues/tasks.js';

const TARGET_SITE = 'yitongkan';
const PURGEABLE_KINDS = ['mv', 'tv'] as const;
export type PurgeableKind = (typeof PURGEABLE_KINDS)[number];

export interface KindPurgePreview {
  kinds: PurgeableKind[];
  collected: number;
  imported: number;
  officialVideos: number;
  queuedJobs: number;
}

export interface KindPurgeResult extends KindPurgePreview {
  collectedDeleted: number;
  videosDeleted: number;
  jobsCancelled: number;
}

function normalizePurgeKinds(kinds: string[]): PurgeableKind[] {
  return PURGEABLE_KINDS.filter((kind) => kinds.includes(kind));
}

function kindPayloadFilter(kinds: PurgeableKind[]) {
  return or(...kinds.map((kind) => sql`${t.collectionJobs.payload}->>'kind' = ${kind}`));
}

async function countQueuedKindJobs(kinds: PurgeableKind[]): Promise<number> {
  if (kinds.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t.collectionJobs)
    .where(
      and(
        eq(t.collectionJobs.targetSite, TARGET_SITE),
        inArray(t.collectionJobs.status, ['queued', 'running']),
        kindPayloadFilter(kinds),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function previewPurgeCollectedKinds(kinds: string[]): Promise<KindPurgePreview> {
  const selected = normalizePurgeKinds(kinds);
  if (selected.length === 0) {
    return { kinds: selected, collected: 0, imported: 0, officialVideos: 0, queuedJobs: 0 };
  }

  const [counts] = await db
    .select({
      collected: sql<number>`count(*)::int`,
      imported: sql<number>`count(*) filter (where ${t.collectedVideos.videoId} is not null)::int`,
    })
    .from(t.collectedVideos)
    .where(and(eq(t.collectedVideos.targetSite, TARGET_SITE), inArray(t.collectedVideos.kind, selected)));

  const videoIds = await db
    .selectDistinct({ videoId: t.collectedVideos.videoId })
    .from(t.collectedVideos)
    .where(
      and(
        eq(t.collectedVideos.targetSite, TARGET_SITE),
        inArray(t.collectedVideos.kind, selected),
        sql`${t.collectedVideos.videoId} is not null`,
      ),
    );

  return {
    kinds: selected,
    collected: Number(counts?.collected ?? 0),
    imported: Number(counts?.imported ?? 0),
    officialVideos: videoIds.length,
    queuedJobs: await countQueuedKindJobs(selected),
  };
}

export async function purgeCollectedKinds(kinds: string[]): Promise<KindPurgeResult> {
  const preview = await previewPurgeCollectedKinds(kinds);
  const selected = preview.kinds;
  if (selected.length === 0) {
    return { ...preview, collectedDeleted: 0, videosDeleted: 0, jobsCancelled: 0 };
  }

  const collected = await db
    .select({
      id: t.collectedVideos.id,
      videoId: t.collectedVideos.videoId,
    })
    .from(t.collectedVideos)
    .where(and(eq(t.collectedVideos.targetSite, TARGET_SITE), inArray(t.collectedVideos.kind, selected)));

  const videoIds = [...new Set(collected.map((row) => row.videoId).filter((id): id is string => Boolean(id)))];
  let videosDeleted = 0;

  if (videoIds.length > 0) {
    const videos = await db
      .select({
        id: t.videos.id,
        sourceKey: t.videos.sourceKey,
        hlsDir: t.videos.hlsDir,
        categoryId: t.videos.categoryId,
      })
      .from(t.videos)
      .where(inArray(t.videos.id, videoIds));

    const storage = await getStorage();
    for (const video of videos) {
      await storage.deletePrefix(`hls/${video.id}`).catch(() => 0);
      await storage.deletePrefix(`assets/${video.id}`).catch(() => 0);
      if (video.hlsDir) await storage.deletePrefix(video.hlsDir).catch(() => 0);
      if (video.sourceKey && !/^https?:\/\//i.test(video.sourceKey)) {
        await storage.delete(video.sourceKey).catch(() => undefined);
      }
      invalidateMediaCache(video.id);
    }

    await db.delete(t.videos).where(inArray(t.videos.id, videos.map((row) => row.id)));
    videosDeleted = videos.length;
    await refreshCategoryCounts([...new Set(videos.map((row) => row.categoryId))]);
  }

  const collectedIds = collected.map((row) => row.id);
  if (collectedIds.length > 0) {
    await db.delete(t.collectedVideos).where(inArray(t.collectedVideos.id, collectedIds));
  }

  const jobs = await db
    .select({ id: t.collectionJobs.id, taskId: t.collectionJobs.taskId })
    .from(t.collectionJobs)
    .where(
      and(
        eq(t.collectionJobs.targetSite, TARGET_SITE),
        inArray(t.collectionJobs.status, ['queued', 'running']),
        kindPayloadFilter(selected),
      ),
    );

  for (const job of jobs) {
    await removeQueueJob(job.taskId);
  }
  if (jobs.length > 0) {
    await db.delete(t.collectionJobs).where(
      inArray(
        t.collectionJobs.id,
        jobs.map((job) => job.id),
      ),
    );
  }

  logger.info(
    {
      kinds: selected,
      collectedDeleted: collectedIds.length,
      videosDeleted,
      jobsCancelled: jobs.length,
    },
    '已清除误抓的非 GV 采集内容',
  );

  return {
    ...preview,
    collectedDeleted: collectedIds.length,
    videosDeleted,
    jobsCancelled: jobs.length,
  };
}
