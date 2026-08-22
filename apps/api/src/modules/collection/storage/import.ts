// ========================================================================
// 采集系统 - 视频导入发布服务
// ========================================================================

import { and, eq, sql } from 'drizzle-orm';
import { db, t } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';
import { AppError } from '../../../core/errors.js';
import { generateUniqueSlug, refreshCategoryCounts } from '../../videos/service.js';
import { StorageDecider, type VideoMetadataForDecision } from './decider.js';
import { HotlinkProxyService } from './hotlink-proxy.js';
import { R2TransferService } from './r2-transfer.js';
import { markAsImported } from './ingestor.js';

/**
 * 采集视频 → 本地 videos 表的导入发布
 *
 * 两种模式：
 * - hotlink: 快速入库。videos.sourceKey 存外部站点的 m3u8 地址，
 *   播放时由热链代理实时换取新地址（源站 token 约 5 分钟过期）。
 * - r2_transfer: 先转存分片到自己的对象存储，再按普通 HLS 视频入库。
 *
 * autoPublish=true 时直接 public + publishedAt，否则 unlisted 待管理员审核。
 */
export async function fromExternalImport(params: {
  collectedVideoId: string;
  userId: string; // 执行导入的管理员
  autoPublish: boolean;
  forceMode?: 'hotlink' | 'r2_transfer'; // 覆盖自动决策
  accessLevel?: 'free' | 'login' | 'vip';
  categoryId?: string | null;
}): Promise<{ videoId: string; importMode: 'hotlink' | 'r2_transfer' }> {
  // 1. 读取采集记录
  const [collected] = await db
    .select()
    .from(t.collectedVideos)
    .where(eq(t.collectedVideos.id, params.collectedVideoId))
    .limit(1);

  if (!collected) throw AppError.notFound('采集视频记录不存在');
  if (collected.videoId) throw AppError.conflict('该视频已导入过');

  const metadata = (collected.metadata ?? {}) as Record<string, unknown>;

  // 2. 决定存储模式
  let importMode: 'hotlink' | 'r2_transfer';
  if (params.forceMode) {
    importMode = params.forceMode;
  } else {
    const decider = StorageDecider.getInstance();
    importMode = await decider.decideStorageMode({
      externalId: collected.externalId,
      title: collected.title,
      publishedAt: typeof metadata.publishedAt === 'string' ? metadata.publishedAt : undefined,
      fetchedAt: collected.createdAt?.toISOString(),
      viewCount: typeof metadata.viewCount === 'number' ? metadata.viewCount : undefined,
      duration: typeof metadata.duration === 'number' ? metadata.duration : undefined,
    });
  }

  logger.info({ collectedVideoId: params.collectedVideoId, importMode }, '开始导入采集视频');

  // 3. 按模式准备播放源
  let hlsDir: string;
  let sourceKey: string;

  if (importMode === 'hotlink') {
    // 热链：立即换取一次播放地址验证可用性（结果会缓存）
    const hotlink = HotlinkProxyService.getInstance();
    const play = await hotlink.getPlayUrl(params.collectedVideoId);
    sourceKey = play.url; // 存源站 m3u8 地址
    hlsDir = `collected/${collected.targetSite}/${collected.externalId}`;
  } else {
    // 转存：走完整 R2 转存流程
    const transfer = R2TransferService.getInstance();
    const result = await transfer.transferVideo(params.collectedVideoId);
    hlsDir = result.masterKey.replace(/\/master\.m3u8$/, '');
    sourceKey = result.masterKey;
  }

  // 4. 生成 slug 与分类映射
  const slug = await generateUniqueSlug(collected.title);
  const categoryId = params.categoryId ?? null;

  // 5. 写入 videos 表
  const [video] = await db
    .insert(t.videos)
    .values({
      slug,
      title: collected.title,
      description: typeof metadata.description === 'string' ? metadata.description : null,
      authorId: params.userId,
      categoryId,
      status: 'ready',
      visibility: params.autoPublish ? 'public' : 'unlisted',
      accessLevel: params.accessLevel ?? 'vip',
      kind: 'vod',
      sourceKey,
      hlsDir,
      posterUrl: typeof metadata.coverUrl === 'string' ? metadata.coverUrl : null,
      durationSeconds: typeof metadata.duration === 'number' ? Math.round(metadata.duration) : 0,
      // 源站列表通常不带分辨率；缺省按 16:9 点播，避免首页横屏过滤把片子筛掉。
      width: typeof metadata.width === 'number' ? metadata.width : 1920,
      height: typeof metadata.height === 'number' ? metadata.height : 1080,
      publishedAt: params.autoPublish ? new Date() : null,
    })
    .returning();

  // 6. 关联采集记录
  await markAsImported(params.collectedVideoId, video!.id, importMode);

  // 7. 刷新分类计数
  await refreshCategoryCounts([categoryId]);

  logger.info({ videoId: video!.id, importMode, autoPublish: params.autoPublish }, '采集视频导入完成');

  return { videoId: video!.id, importMode };
}

/**
 * 批量导入
 */
export async function batchFromExternalImport(params: {
  collectedVideoIds: string[];
  userId: string;
  autoPublish: boolean;
  forceMode?: 'hotlink' | 'r2_transfer';
  categoryId?: string | null;
}): Promise<{
  imported: Array<{ collectedVideoId: string; videoId: string; importMode: string }>;
  failed: Array<{ collectedVideoId: string; error: string }>;
}> {
  const imported: Array<{ collectedVideoId: string; videoId: string; importMode: string }> = [];
  const failed: Array<{ collectedVideoId: string; error: string }> = [];

  for (const id of params.collectedVideoIds) {
    try {
      const result = await fromExternalImport({
        collectedVideoId: id,
        userId: params.userId,
        autoPublish: params.autoPublish,
        forceMode: params.forceMode,
        categoryId: params.categoryId,
      });
      imported.push({ collectedVideoId: id, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ collectedVideoId: id, err: error }, '批量导入单项失败');
      failed.push({ collectedVideoId: id, error: message });
    }
  }

  return { imported, failed };
}

const IMPORT_BATCH_MAX = 80;

/**
 * 导入下一批待入库记录。allPending 场景由前端循环调用直到 remaining=0。
 */
export async function importPendingVideos(params: {
  userId: string;
  autoPublish: boolean;
  forceMode?: 'hotlink' | 'r2_transfer';
  categoryId?: string | null;
  kind?: 'gv' | 'mv' | 'tv';
  batchSize?: number;
}): Promise<{
  imported: Array<{ collectedVideoId: string; videoId: string; importMode: string }>;
  failed: Array<{ collectedVideoId: string; error: string }>;
  processed: number;
  remaining: number;
}> {
  const batchSize = Math.min(IMPORT_BATCH_MAX, Math.max(1, params.batchSize ?? 40));
  const conditions = [
    eq(t.collectedVideos.targetSite, 'yitongkan'),
    eq(t.collectedVideos.status, 'pending'),
  ];
  if (params.kind) conditions.push(eq(t.collectedVideos.kind, params.kind));

  const rows = await db
    .select({ id: t.collectedVideos.id })
    .from(t.collectedVideos)
    .where(and(...conditions))
    .orderBy(t.collectedVideos.createdAt)
    .limit(batchSize);

  const ids = rows.map((row) => row.id);
  const result =
    ids.length === 0
      ? { imported: [], failed: [] }
      : await batchFromExternalImport({
          collectedVideoIds: ids,
          userId: params.userId,
          autoPublish: params.autoPublish,
          forceMode: params.forceMode,
          categoryId: params.categoryId,
        });

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(t.collectedVideos)
    .where(and(...conditions));

  return {
    ...result,
    processed: ids.length,
    remaining: Number(countRow?.total ?? 0),
  };
}

/**
 * 下架采集导入的视频（软处理：unlisted + 归档采集记录）
 */
export async function unpublishCollectedVideo(collectedVideoId: string): Promise<void> {
  const [collected] = await db
    .select()
    .from(t.collectedVideos)
    .where(eq(t.collectedVideos.id, collectedVideoId))
    .limit(1);

  if (!collected) throw AppError.notFound('采集视频记录不存在');

  if (collected.videoId) {
    await db
      .update(t.videos)
      .set({ visibility: 'private', updatedAt: new Date() })
      .where(eq(t.videos.id, collected.videoId));
  }

  await db
    .update(t.collectedVideos)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(t.collectedVideos.id, collectedVideoId));

  logger.info({ collectedVideoId }, '采集视频已下架归档');
}
