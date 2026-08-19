import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { HLS_SEGMENT_SECONDS, FAST_START_RENDITION, reviewHoldPatch } from '@videox/shared';
import { deriveHlsContentKey, deriveHlsIv } from '@videox/shared/play-token';
import { db, t } from '@videox/api/core/db';
import { env } from '@videox/api/config/env';
import { getStorage, StorageKeys, contentTypeFor } from '@videox/api/storage';
import type { RenditionRecord } from '@videox/db';
import type { TranscodeJobData } from '@videox/api/core/queue';
import { logger } from '../logger.js';
import { probe, runFfmpeg } from '../ffmpeg.js';
import { buildRenditionArgs, planLadder, type PlannedRendition } from '../ladder.js';
import { generatePosters, generatePreview, generateSprite } from '../assets.js';

const ENCODER = {
  none: 'libx264',
  nvenc: 'h264_nvenc',
  qsv: 'h264_qsv',
} as const;

/**
 * master.m3u8 由 worker 生成并落存储。
 *
 * 首档产出后就写一版只含该档的 master，让视频立刻可播（partially_ready）；
 * 每补齐一档就重写一次，播放器下次拉 manifest 就能看到新清晰度。
 */
function buildMaster(renditions: RenditionRecord[], fps: number): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', ''];
  for (const r of [...renditions].filter((r) => r.ready).sort((a, b) => a.bandwidth - b.bandwidth)) {
    const attrs = [
      `BANDWIDTH=${r.bandwidth}`,
      `AVERAGE-BANDWIDTH=${Math.round(r.bandwidth * 0.85)}`,
      `RESOLUTION=${r.width}x${r.height}`,
      'CODECS="avc1.640028,mp4a.40.2"',
    ];
    if (fps > 0) attrs.push(`FRAME-RATE=${fps.toFixed(3)}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`);
    lines.push(`${r.name}/index.m3u8`);
  }
  return `${lines.join('\n')}\n`;
}

async function updateJob(
  jobId: string,
  patch: Partial<typeof t.transcodeJobs.$inferInsert>,
): Promise<void> {
  await db.update(t.transcodeJobs).set({ ...patch, updatedAt: new Date() }).where(eq(t.transcodeJobs.id, jobId));
}

/** 把源文件从存储层拉到本地临时目录：ffmpeg 需要可随机寻址的本地文件。 */
async function materializeSource(sourceKey: string, destPath: string): Promise<number> {
  const storage = await getStorage();
  const result = await storage.get(sourceKey);
  await pipeline(result.stream, fs.createWriteStream(destPath));
  const stat = await fsp.stat(destPath);
  return stat.size;
}

/** 上传一个目录下的全部文件，返回累计字节数。 */
async function uploadDir(localDir: string, keyPrefix: string): Promise<number> {
  const storage = await getStorage();
  const entries = await fsp.readdir(localDir, { withFileTypes: true });
  let bytes = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const localPath = path.join(localDir, entry.name);
    const stat = await fsp.stat(localPath);
    await storage.put(
      `${keyPrefix}/${entry.name}`,
      fs.createReadStream(localPath),
      contentTypeFor(entry.name),
    );
    bytes += stat.size;
  }

  return bytes;
}

/**
 * 会员视频的 AES-128 密钥信息文件。
 *
 * 第一行是**写进 m3u8 的 URI**，指向要鉴权的 /media/hls/:id/key；
 * 第二行是 ffmpeg 本地读取的密钥文件路径。密钥由 HLS_KEY_SECRET + videoId
 * 派生，因此不需要落库，重转码也能得到同一把钥匙。
 */
async function writeKeyInfo(videoId: string, dir: string): Promise<string> {
  const key = deriveHlsContentKey(videoId, env.HLS_KEY_SECRET);
  const iv = deriveHlsIv(videoId, env.HLS_KEY_SECRET);

  const keyPath = path.join(dir, 'content.key');
  await fsp.writeFile(keyPath, key);

  const keyInfoPath = path.join(dir, 'key.info');
  await fsp.writeFile(
    keyInfoPath,
    [`${env.API_PUBLIC_URL}/media/hls/${videoId}/key`, keyPath.replace(/\\/g, '/'), iv.toString('hex')].join('\n'),
    'utf8',
  );

  return keyInfoPath;
}

export async function runTranscodeJob(job: Job<TranscodeJobData>): Promise<void> {
  const { videoId, jobId, sourceKey, encrypt, skipAssets } = job.data;
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), `videox-${videoId.slice(0, 8)}-`));
  const log = logger.child({ videoId, jobId });

  const abort = new AbortController();

  try {
    await updateJob(jobId, {
      status: 'probing',
      stage: '准备源文件',
      progress: 0,
      startedAt: new Date(),
      queueJobId: String(job.id ?? ''),
      errorMessage: null,
    });
    await db.update(t.videos).set({ status: 'transcoding', updatedAt: new Date() }).where(eq(t.videos.id, videoId));

    // ---- 1. 取源文件 -----------------------------------------------------
    const sourcePath = path.join(workDir, 'source.bin');
    const sourceSize = await materializeSource(sourceKey, sourcePath);
    log.info({ sourceSize }, '源文件已就绪');

    // ---- 2. 探测 ---------------------------------------------------------
    await updateJob(jobId, { status: 'probing', stage: '探测元数据', progress: 2 });
    const meta = await probe(sourcePath);
    log.info({ ...meta }, '源文件元数据');

    await db
      .update(t.videos)
      .set({
        durationSeconds: Math.round(meta.durationSeconds),
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        sourceSizeBytes: sourceSize,
        isEncrypted: encrypt,
        updatedAt: new Date(),
      })
      .where(eq(t.videos.id, videoId));

    // ---- 3. 封面 / 雪碧图 / 预览片 ---------------------------------------
    if (!skipAssets) {
      await updateJob(jobId, { status: 'thumbnailing', stage: '生成封面与预览图', progress: 5 });
      const assetDir = path.join(workDir, 'assets');
      await fsp.mkdir(assetDir, { recursive: true });
      const storage = await getStorage();

      try {
        const posters = await generatePosters({ input: sourcePath, outDir: assetDir, probe: meta });
        await storage.putFile(StorageKeys.poster(videoId), posters.posterPath, 'image/jpeg');
        await storage.putFile(StorageKeys.verticalPoster(videoId), posters.verticalPosterPath, 'image/jpeg');
        await db
          .update(t.videos)
          .set({
            posterUrl: `/media/assets/${videoId}/poster.jpg`,
            verticalPosterUrl: `/media/assets/${videoId}/poster-vertical.jpg`,
            updatedAt: new Date(),
          })
          .where(eq(t.videos.id, videoId));
      } catch (error) {
        log.warn({ err: error }, '封面生成失败，继续转码');
      }

      try {
        const sprite = await generateSprite({
          input: sourcePath,
          outDir: assetDir,
          probe: meta,
          spriteUrl: `/media/assets/${videoId}/sprite.jpg`,
        });
        if (sprite) {
          await storage.putFile(StorageKeys.sprite(videoId), sprite.spritePath, 'image/jpeg');
          await storage.putFile(StorageKeys.spriteVtt(videoId), sprite.vttPath, 'text/vtt');
          await db
            .update(t.videos)
            .set({
              spriteUrl: `/media/assets/${videoId}/sprite.jpg`,
              spriteVttUrl: `/media/assets/${videoId}/thumbnails.vtt`,
              updatedAt: new Date(),
            })
            .where(eq(t.videos.id, videoId));
        }
      } catch (error) {
        log.warn({ err: error }, '雪碧图生成失败，继续转码');
      }

      try {
        const preview = await generatePreview({ input: sourcePath, outDir: assetDir, probe: meta });
        if (preview) {
          await storage.putFile(StorageKeys.preview(videoId), preview, 'video/mp4');
          await db
            .update(t.videos)
            .set({ previewUrl: `/media/assets/${videoId}/preview.mp4`, updatedAt: new Date() })
            .where(eq(t.videos.id, videoId));
        }
      } catch (error) {
        log.warn({ err: error }, '预览片生成失败，继续转码');
      }
    }

    // ---- 4. 逐档转码 -----------------------------------------------------
    const ladder = planLadder(meta);
    const keyInfoFile = encrypt ? await writeKeyInfo(videoId, workDir) : undefined;
    const encoder = ENCODER[env.TRANSCODE_HWACCEL];

    const records: RenditionRecord[] = [];
    let outputBytes = 0;
    // 资源阶段占 10%，剩下 90% 按档位均分。
    const perRendition = 90 / ladder.length;

    for (const [index, rendition] of ladder.entries()) {
      const base = 10 + index * perRendition;

      await updateJob(jobId, {
        status: 'transcoding',
        stage: `转码 ${rendition.name}`,
        currentRendition: rendition.name,
        progress: Math.round(base),
      });

      const outDir = path.join(workDir, rendition.name);
      await fsp.mkdir(outDir, { recursive: true });

      let lastReported = 0;
      await runFfmpeg({
        args: buildRenditionArgs({
          input: sourcePath,
          outputDir: outDir.replace(/\\/g, '/'),
          rendition,
          fps: meta.fps,
          hasAudio: meta.hasAudio,
          preset: env.TRANSCODE_PRESET,
          segmentSeconds: HLS_SEGMENT_SECONDS,
          keyInfoFile: keyInfoFile?.replace(/\\/g, '/'),
          encoder,
        }),
        totalSeconds: meta.durationSeconds,
        signal: abort.signal,
        onProgress: (percent) => {
          const overall = base + (percent / 100) * perRendition;
          // 数据库写入节流：进度每涨 2% 才落一次库。
          if (overall - lastReported < 2) return;
          lastReported = overall;
          void job.updateProgress(Math.round(overall));
          void (async () => {
            const [row] = await db
              .select({ status: t.transcodeJobs.status })
              .from(t.transcodeJobs)
              .where(eq(t.transcodeJobs.id, jobId))
              .limit(1);
            // 后台点了「取消」就直接掐掉 ffmpeg，不等它跑完这一档。
            if (row?.status === 'canceled') {
              abort.abort();
              return;
            }
            await updateJob(jobId, { progress: Math.round(overall) });
          })().catch(() => undefined);
        },
      });

      const bytes = await uploadDir(outDir, `hls/${videoId}/${rendition.name}`);
      outputBytes += bytes;

      records.push({
        name: rendition.name,
        width: rendition.width,
        height: rendition.height,
        bandwidth: rendition.bandwidth,
        ready: true,
        playlist: `${rendition.name}/index.m3u8`,
        sizeBytes: bytes,
      });

      await db
        .insert(t.videoRenditions)
        .values({
          videoId,
          name: rendition.name,
          width: rendition.width,
          height: rendition.height,
          bandwidth: rendition.bandwidth,
          playlistKey: StorageKeys.renditionPlaylist(videoId, rendition.name),
          sizeBytes: bytes,
          durationSeconds: meta.durationSeconds,
        })
        .onConflictDoUpdate({
          target: [t.videoRenditions.videoId, t.videoRenditions.name],
          set: { bandwidth: rendition.bandwidth, sizeBytes: bytes, durationSeconds: meta.durationSeconds },
        });

      // 每补齐一档就重写 master，实现「首档就绪即可播」。
      const storage = await getStorage();
      await storage.put(StorageKeys.master(videoId), Buffer.from(buildMaster(records, meta.fps), 'utf8'), 'application/vnd.apple.mpegurl');

      const isLast = index === ladder.length - 1;
      const [current] = await db
        .select({ visibility: t.videos.visibility, publishedAt: t.videos.publishedAt })
        .from(t.videos)
        .where(eq(t.videos.id, videoId))
        .limit(1);
      await db
        .update(t.videos)
        .set({
          renditions: records,
          hlsDir: StorageKeys.hlsDir(videoId),
          outputBytes,
          // 首档产出即可播，但只有全部档位补齐才算 ready。
          status: isLast ? 'ready' : 'partially_ready',
          ...reviewHoldPatch(current ?? { visibility: 'public', publishedAt: null }),
          updatedAt: new Date(),
        })
        .where(eq(t.videos.id, videoId));

      await updateJob(jobId, {
        completedRenditions: records.map((r) => r.name),
        progress: Math.round(base + perRendition),
      });

      log.info({ rendition: rendition.name, bytes }, '档位产出完成');
      await fsp.rm(outDir, { recursive: true, force: true });
    }

    // ---- 5. 收尾 ---------------------------------------------------------
    const [current] = await db
      .select({ visibility: t.videos.visibility, publishedAt: t.videos.publishedAt })
      .from(t.videos)
      .where(eq(t.videos.id, videoId))
      .limit(1);
    await db
      .update(t.videos)
      .set({
        status: 'ready',
        renditions: records,
        outputBytes,
        ...reviewHoldPatch(current ?? { visibility: 'public', publishedAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(t.videos.id, videoId));

    await updateJob(jobId, {
      status: 'completed',
      stage: '完成',
      progress: 100,
      currentRendition: null,
      finishedAt: new Date(),
    });

    log.info({ renditions: records.length, outputBytes }, '转码完成');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, '转码失败');

    await updateJob(jobId, {
      status: 'failed',
      stage: '失败',
      errorMessage: message.slice(0, 2000),
      finishedAt: new Date(),
    }).catch(() => undefined);

    await db
      .update(t.videos)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(t.videos.id, videoId))
      .catch(() => undefined);

    throw error;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
