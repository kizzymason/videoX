import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, eq, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { UploadSession } from '@videox/shared';
import { db, t, uuidArray } from '../../core/db.js';
import { env } from '../../config/env.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { getTranscodeQueue } from '../../core/queue.js';
import { getStorage } from '../storage/service.js';
import { StorageKeys } from '../storage/keys.js';
import { generateUniqueSlug, syncVideoTags, refreshCategoryCounts } from '../videos/service.js';
import { canReuseInstantAssets } from './access-level.js';

export type UploadSessionRow = typeof t.uploadSessions.$inferSelect;

export function toUploadSession(row: UploadSessionRow, instant = false): UploadSession {
  return {
    id: row.id,
    filename: row.filename,
    fileSize: row.fileSize,
    chunkSize: row.chunkSize,
    totalChunks: row.totalChunks,
    receivedChunks: row.receivedChunks ?? [],
    status: row.status as UploadSession['status'],
    videoId: row.videoId,
    instant,
    createdAt: row.createdAt.toISOString(),
  };
}

function sessionDir(uploadId: string): string {
  return path.join(env.uploadTmpDir, uploadId);
}

function chunkPath(uploadId: string, index: number): string {
  return path.join(sessionDir(uploadId), `part-${String(index).padStart(6, '0')}`);
}

/**
 * 初始化上传。若同一份文件（SHA-256 相同）此前已成功转码过，
 * 直接复用它的产物完成「秒传」，只新建一条视频记录指向同一批 HLS 文件。
 */
export async function initUpload(input: {
  userId: string;
  filename: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  fileHash?: string;
  mimeType?: string;
}): Promise<{ session: UploadSession; existingVideoId: string | null }> {
  if (input.fileHash) {
    const [existing] = await db
      .select({ id: t.videos.id, status: t.videos.status })
      .from(t.videos)
      .where(and(eq(t.videos.sourceHash, input.fileHash), eq(t.videos.status, 'ready')))
      .limit(1);

    if (existing) {
      const [row] = await db
        .insert(t.uploadSessions)
        .values({
          userId: input.userId,
          filename: input.filename,
          mimeType: input.mimeType ?? null,
          fileSize: input.fileSize,
          fileHash: input.fileHash,
          chunkSize: input.chunkSize,
          totalChunks: input.totalChunks,
          receivedChunks: Array.from({ length: input.totalChunks }, (_, i) => i),
          tempDir: '',
          status: 'completed',
          // 记住命中的源视频：complete 阶段要靠它克隆产物，否则秒传无从下手。
          videoId: existing.id,
        })
        .returning();
      return { session: toUploadSession(row!, true), existingVideoId: existing.id };
    }
  }

  // 断点续传：同一用户 + 同一文件指纹的未完成会话直接复用。
  if (input.fileHash) {
    const [pending] = await db
      .select()
      .from(t.uploadSessions)
      .where(
        and(
          eq(t.uploadSessions.userId, input.userId),
          eq(t.uploadSessions.fileHash, input.fileHash),
          sql`${t.uploadSessions.status} in ('pending','uploading')`,
        ),
      )
      .limit(1);

    if (pending) {
      // 以磁盘为准重建已收分片清单，避免进程崩溃后状态漂移。
      const onDisk = await scanReceivedChunks(pending.id, pending.totalChunks);
      const [updated] = await db
        .update(t.uploadSessions)
        .set({ receivedChunks: onDisk, updatedAt: new Date() })
        .where(eq(t.uploadSessions.id, pending.id))
        .returning();
      return { session: toUploadSession(updated!), existingVideoId: null };
    }
  }

  const [row] = await db
    .insert(t.uploadSessions)
    .values({
      userId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize,
      fileHash: input.fileHash ?? null,
      chunkSize: input.chunkSize,
      totalChunks: input.totalChunks,
      receivedChunks: [],
      tempDir: '',
      status: 'pending',
    })
    .returning();

  const dir = sessionDir(row!.id);
  await fsp.mkdir(dir, { recursive: true });
  await db.update(t.uploadSessions).set({ tempDir: dir }).where(eq(t.uploadSessions.id, row!.id));

  return { session: toUploadSession({ ...row!, tempDir: dir }), existingVideoId: null };
}

async function scanReceivedChunks(uploadId: string, totalChunks: number): Promise<number[]> {
  const dir = sessionDir(uploadId);
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  const found = new Set<number>();
  for (const name of entries) {
    const match = /^part-(\d{6})$/.exec(name);
    if (match) {
      const index = Number(match[1]);
      if (index < totalChunks) found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export async function getUploadSession(uploadId: string, userId: string): Promise<UploadSessionRow> {
  const [row] = await db.select().from(t.uploadSessions).where(eq(t.uploadSessions.id, uploadId)).limit(1);
  if (!row) throw AppError.notFound('上传会话不存在');
  if (row.userId !== userId) throw AppError.forbidden('无权访问该上传会话');
  return row;
}

/**
 * 接收单个分片。写入临时文件后校验 SHA-256，不匹配直接删除让客户端重传，
 * 避免坏分片被合并进最终文件。
 */
export async function receiveChunk(params: {
  uploadId: string;
  userId: string;
  index: number;
  stream: Readable;
  expectedHash?: string;
}): Promise<{ received: number[]; complete: boolean }> {
  const session = await getUploadSession(params.uploadId, params.userId);
  if (session.status === 'completed') throw AppError.badRequest('该上传已完成');
  if (session.status === 'aborted') throw AppError.badRequest('该上传已取消');
  if (params.index < 0 || params.index >= session.totalChunks) {
    throw AppError.badRequest('分片序号超出范围');
  }

  const dir = sessionDir(params.uploadId);
  await fsp.mkdir(dir, { recursive: true });

  const target = chunkPath(params.uploadId, params.index);
  const temp = `${target}.tmp`;

  const hasher = createHash('sha256');
  params.stream.on('data', (chunk: Buffer) => hasher.update(chunk));
  await pipeline(params.stream, fs.createWriteStream(temp));

  const digest = hasher.digest('hex');
  if (params.expectedHash && params.expectedHash.toLowerCase() !== digest) {
    await fsp.unlink(temp).catch(() => undefined);
    throw new AppError({
      message: '分片校验失败，请重传该分片',
      code: ErrorCode.CHUNK_CHECKSUM_MISMATCH,
      status: 422,
    });
  }

  await fsp.rename(temp, target);

  const received = await scanReceivedChunks(params.uploadId, session.totalChunks);
  await db
    .update(t.uploadSessions)
    .set({ receivedChunks: received, status: 'uploading', updatedAt: new Date() })
    .where(eq(t.uploadSessions.id, params.uploadId));

  return { received, complete: received.length === session.totalChunks };
}

/**
 * 合并分片并入队转码。
 * 合并过程是流式追加，不会把整个文件读进内存。
 */
export async function completeUpload(params: {
  uploadId: string;
  userId: string;
  title?: string;
  description?: string;
  categoryId?: string | null;
  tags?: string[];
  accessLevel: 'free' | 'login' | 'vip';
  visibility: 'public' | 'unlisted' | 'private';
}): Promise<{ videoId: string; jobId: string }> {
  const session = await getUploadSession(params.uploadId, params.userId);

  const received = await scanReceivedChunks(params.uploadId, session.totalChunks);
  if (received.length !== session.totalChunks) {
    const missing = Array.from({ length: session.totalChunks }, (_, i) => i).filter((i) => !received.includes(i));
    throw new AppError({
      message: `还有 ${missing.length} 个分片未上传完成`,
      code: ErrorCode.UPLOAD_SESSION_INVALID,
      status: 409,
      details: { missing: missing.slice(0, 50) },
    });
  }

  const dir = sessionDir(params.uploadId);
  const mergedPath = path.join(dir, 'merged.bin');
  const output = fs.createWriteStream(mergedPath);
  const hasher = createHash('sha256');

  try {
    for (let i = 0; i < session.totalChunks; i += 1) {
      const input = fs.createReadStream(chunkPath(params.uploadId, i));
      input.on('data', (chunk) => {
        hasher.update(chunk);
      });
      await new Promise<void>((resolve, reject) => {
        input.on('error', reject);
        input.on('end', resolve);
        input.pipe(output, { end: false });
      });
    }
  } finally {
    output.end();
    await new Promise<void>((resolve) => output.on('close', () => resolve()));
  }

  const fileHash = hasher.digest('hex');
  const stat = await fsp.stat(mergedPath);

  const title = params.title?.trim() || path.parse(session.filename).name;
  const slug = await generateUniqueSlug(title);
  const ext = (path.extname(session.filename) || '.mp4').slice(1).toLowerCase();

  const [video] = await db
    .insert(t.videos)
    .values({
      slug,
      title,
      description: params.description ?? null,
      authorId: params.userId,
      categoryId: params.categoryId ?? null,
      status: 'queued',
      // 新上传先待审：公开意图也压成 unlisted，后台通过才进前台。
      visibility: params.visibility === 'private' ? 'private' : 'unlisted',
      accessLevel: params.accessLevel,
      sourceSizeBytes: stat.size,
      sourceHash: fileHash,
      isEncrypted: params.accessLevel === 'vip',
    })
    .returning();

  const sourceKey = StorageKeys.source(video!.id, ext);
  const storage = await getStorage();
  await storage.putFile(sourceKey, mergedPath);

  await db
    .update(t.videos)
    .set({ sourceKey, hlsDir: StorageKeys.hlsDir(video!.id) })
    .where(eq(t.videos.id, video!.id));

  if (params.tags?.length) await syncVideoTags(video!.id, params.tags);
  await refreshCategoryCounts([params.categoryId ?? null]);

  await db
    .update(t.uploadSessions)
    .set({ status: 'completed', videoId: video!.id, fileHash, updatedAt: new Date() })
    .where(eq(t.uploadSessions.id, params.uploadId));

  // 分片已经合并并上传，临时目录可以清掉了。
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);

  const jobId = await enqueueTranscode(video!.id, sourceKey, params.accessLevel === 'vip');

  await db
    .update(t.users)
    .set({ videoCount: sql`${t.users.videoCount} + 1` })
    .where(eq(t.users.id, params.userId));

  return { videoId: video!.id, jobId };
}

export async function enqueueTranscode(videoId: string, sourceKey: string, encrypt: boolean): Promise<string> {
  const [job] = await db
    .insert(t.transcodeJobs)
    .values({ videoId, status: 'queued', progress: 0, stage: '排队中' })
    .returning();

  const queued = await getTranscodeQueue().add(
    'transcode',
    { videoId, jobId: job!.id, sourceKey, encrypt },
    { jobId: job!.id },
  );

  await db
    .update(t.transcodeJobs)
    .set({ queueJobId: String(queued.id ?? job!.id) })
    .where(eq(t.transcodeJobs.id, job!.id));

  await db.update(t.videos).set({ status: 'queued' }).where(eq(t.videos.id, videoId));

  logger.info({ videoId, jobId: job!.id }, '转码任务已入队');
  return job!.id;
}

/** 秒传：复用已有视频的转码产物，直接生成一条 ready 的新记录。仅同档同加密可走。 */
export async function cloneFromExisting(params: {
  sourceVideoId: string;
  userId: string;
  title?: string;
  description?: string;
  categoryId?: string | null;
  tags?: string[];
  accessLevel: 'free' | 'login' | 'vip';
  visibility: 'public' | 'unlisted' | 'private';
}): Promise<{ videoId: string }> {
  const [source] = await db.select().from(t.videos).where(eq(t.videos.id, params.sourceVideoId)).limit(1);
  if (!source) throw AppError.notFound('源视频不存在');
  if (!canReuseInstantAssets(source, params.accessLevel)) {
    throw AppError.conflict('不能跨会员档秒传');
  }

  const title = params.title?.trim() || source.title;
  const slug = await generateUniqueSlug(title);

  const [video] = await db
    .insert(t.videos)
    .values({
      slug,
      title,
      description: params.description ?? source.description,
      authorId: params.userId,
      categoryId: params.categoryId ?? null,
      status: 'ready',
      // 秒传也走闸门：新纪录未审，不直接上前台。
      visibility: params.visibility === 'private' ? 'private' : 'unlisted',
      accessLevel: params.accessLevel,
      // 直接指向同一批产物，不复制文件。
      sourceKey: source.sourceKey,
      sourceSizeBytes: source.sourceSizeBytes,
      sourceHash: source.sourceHash,
      hlsDir: source.hlsDir,
      posterUrl: source.posterUrl,
      verticalPosterUrl: source.verticalPosterUrl,
      previewUrl: source.previewUrl,
      spriteUrl: source.spriteUrl,
      spriteVttUrl: source.spriteVttUrl,
      durationSeconds: source.durationSeconds,
      width: source.width,
      height: source.height,
      fps: source.fps,
      renditions: source.renditions,
      isEncrypted: source.isEncrypted,
      publishedAt: null,
    })
    .returning();

  if (params.tags?.length) await syncVideoTags(video!.id, params.tags);
  await refreshCategoryCounts([params.categoryId ?? null]);

  return { videoId: video!.id };
}

/**
 * 秒传收口：同档克隆 HLS；跨档复用源文件按新档入队重转，绝不把会员加密片标成免费可播。
 */
export async function finalizeInstantUpload(params: {
  sourceVideoId: string;
  userId: string;
  title?: string;
  description?: string;
  categoryId?: string | null;
  tags?: string[];
  accessLevel: 'free' | 'login' | 'vip';
  visibility: 'public' | 'unlisted' | 'private';
}): Promise<{ videoId: string; jobId: string | null; instant: boolean }> {
  const [source] = await db.select().from(t.videos).where(eq(t.videos.id, params.sourceVideoId)).limit(1);
  if (!source) throw AppError.notFound('源视频不存在');

  if (canReuseInstantAssets(source, params.accessLevel)) {
    const { videoId } = await cloneFromExisting(params);
    return { videoId, jobId: null, instant: true };
  }

  if (!source.sourceKey) {
    throw AppError.conflict('跨档无法秒传，且找不到可重转的源文件，请重新上传');
  }

  const title = params.title?.trim() || source.title;
  const slug = await generateUniqueSlug(title);
  const [video] = await db
    .insert(t.videos)
    .values({
      slug,
      title,
      description: params.description ?? source.description,
      authorId: params.userId,
      categoryId: params.categoryId ?? null,
      status: 'queued',
      visibility: params.visibility === 'private' ? 'private' : 'unlisted',
      accessLevel: params.accessLevel,
      sourceKey: source.sourceKey,
      sourceSizeBytes: source.sourceSizeBytes,
      sourceHash: source.sourceHash,
      isEncrypted: params.accessLevel === 'vip',
    })
    .returning();

  await db
    .update(t.videos)
    .set({ hlsDir: StorageKeys.hlsDir(video!.id) })
    .where(eq(t.videos.id, video!.id));

  if (params.tags?.length) await syncVideoTags(video!.id, params.tags);
  await refreshCategoryCounts([params.categoryId ?? null]);

  const jobId = await enqueueTranscode(video!.id, source.sourceKey, params.accessLevel === 'vip');

  await db
    .update(t.users)
    .set({ videoCount: sql`${t.users.videoCount} + 1` })
    .where(eq(t.users.id, params.userId));

  return { videoId: video!.id, jobId, instant: false };
}

export async function abortUpload(uploadId: string, userId: string): Promise<void> {
  const session = await getUploadSession(uploadId, userId);
  await fsp.rm(sessionDir(session.id), { recursive: true, force: true }).catch(() => undefined);
  await db
    .update(t.uploadSessions)
    .set({ status: 'aborted', updatedAt: new Date() })
    .where(eq(t.uploadSessions.id, uploadId));
}

/** 清理超过 24 小时未完成的上传，回收磁盘。 */
export async function pruneStaleUploads(): Promise<number> {
  const stale = await db
    .select({ id: t.uploadSessions.id })
    .from(t.uploadSessions)
    .where(sql`${t.uploadSessions.status} in ('pending','uploading') and ${t.uploadSessions.updatedAt} < now() - interval '24 hours'`);

  for (const row of stale) {
    await fsp.rm(sessionDir(row.id), { recursive: true, force: true }).catch(() => undefined);
  }

  if (stale.length > 0) {
    await db
      .update(t.uploadSessions)
      .set({ status: 'aborted' })
      .where(sql`${t.uploadSessions.id} = any(${uuidArray(stale.map((s) => s.id))})`);
  }
  return stale.length;
}
