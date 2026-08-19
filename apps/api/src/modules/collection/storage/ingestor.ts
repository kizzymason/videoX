// ========================================================================
// 采集系统 - 视频入库处理器
// ========================================================================

import { and, eq } from 'drizzle-orm';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';

export interface CollectedVideoMetadata {
  externalId: number;
  title: string;
  coverUrl?: string;
  duration?: number;
  publishedAt?: string;
  fetchedAt: string;
  [key: string]: unknown;
}

export interface UpsertCollectedVideoParams {
  externalId: string;
  targetSite: string;
  kind: string;
  title: string;
  metadata: Record<string, unknown>;
  status: string;
  page?: number;
}

/**
 * 插入或更新采集到的视频记录
 * 如果已存在（同 externalId + targetSite），则更新元数据；否则插入新记录
 * 返回 id 与是否新建（isNew=true 时 worker 可级联生成详情拉取任务）
 */
export async function upsertCollectedVideo(params: UpsertCollectedVideoParams): Promise<{
  id: string;
  isNew: boolean;
}> {
  // 1. 先查询是否已存在
  const existing = await db
    .select()
    .from(t.collectedVideos)
    .where(and(
      eq(t.collectedVideos.externalId, params.externalId),
      eq(t.collectedVideos.targetSite, params.targetSite),
    ))
    .limit(1);

  if (existing.length > 0) {
    // 2a. 已存在，更新元数据（已导入的不动状态）
    const [updated] = await db
      .update(t.collectedVideos)
      .set({
        title: params.title,
        metadata: params.metadata,
        ...(existing[0]!.status === 'imported' || existing[0]!.status === 'archived'
          ? {}
          : { status: params.status }),
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
        ...(params.page && { page: params.page }),
      })
      .where(eq(t.collectedVideos.id, existing[0].id))
      .returning();

    logger.debug({ videoId: updated.id, externalId: params.externalId }, '已更新采集视频');
    return { id: updated.id, isNew: false };
  } else {
    // 2b. 不存在，插入新记录
    const [inserted] = await db
      .insert(t.collectedVideos)
      .values({
        externalId: params.externalId,
        targetSite: params.targetSite,
        kind: params.kind,
        title: params.title,
        metadata: params.metadata,
        status: params.status,
        ...(params.page && { page: params.page }),
        lastFetchedAt: new Date(),
      })
      .returning();

    logger.info({ videoId: inserted.id, externalId: params.externalId }, '新增采集视频');
    return { id: inserted.id, isNew: true };
  }
}

/**
 * 批量入库（供批量导入场景使用）
 */
export async function batchUpsertCollectedVideos(videos: UpsertCollectedVideoParams[]): Promise<
  Array<{ id: string; isNew: boolean }>
> {
  const results: Array<{ id: string; isNew: boolean }> = [];

  // 逐条处理避免事务过大
  for (const video of videos) {
    results.push(await upsertCollectedVideo(video));
  }

  return results;
}

/**
 * 根据外部 ID 查询视频
 */
export async function getCollectedVideoByExternalId(
  externalId: string,
  targetSite: string
): Promise<Record<string, unknown> | null> {
  const results = await db
    .select()
    .from(t.collectedVideos)
    .where(and(
      eq(t.collectedVideos.externalId, externalId),
      eq(t.collectedVideos.targetSite, targetSite),
    ))
    .limit(1);
  
  return results[0] ?? null;
}

/**
 * 将采集视频标记为已导入
 */
export async function markAsImported(
  collectedVideoId: string,
  videoId: string,
  importMode: 'hotlink' | 'r2_transfer' | 'none'
): Promise<void> {
  await db
    .update(t.collectedVideos)
    .set({
      videoId,
      importMode,
      status: 'imported',
      importedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(t.collectedVideos.id, collectedVideoId));
  
  logger.info({ collectedVideoId, videoId, importMode }, '采集视频已标记为已导入');
}

/**
 * 查询待导入的视频列表
 */
export async function getPendingImportVideos(
  targetSite: string,
  limit: number = 100
): Promise<Array<Record<string, unknown>>> {
  return await db
    .select()
    .from(t.collectedVideos)
    .where(and(
      eq(t.collectedVideos.targetSite, targetSite),
      eq(t.collectedVideos.status, 'pending'),
    ))
    .limit(limit);
}
