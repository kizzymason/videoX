import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { deriveHlsContentKey } from '@videox/shared/play-token';
import { db, t } from '../../core/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler } from '../../core/respond.js';
import { logger } from '../../core/logger.js';
import { getStorage } from '../storage/service.js';
import { contentTypeFor, sanitizeKey, type Storage } from '../storage/driver.js';
import { getSiteSettings } from '../settings/service.js';
import { evaluateGate, findVideoByIdOrSlug } from '../videos/service.js';
import { HotlinkProxyService } from '../collection/storage/hotlink-proxy.js';
import {
  PLAY_TOKEN_COOKIE,
  PLAY_TOKEN_PARAM,
  registerStream,
  requirePlayToken,
  streamSessionKey,
} from './play-token.js';
import {
  MANIFEST_CACHE_HEADERS,
  SEGMENT_CACHE_HEADERS,
  injectTokenIntoPlaylist,
  rewriteKeyUri,
} from './manifest.js';

export const mediaRouter: Router = Router();

function setDirectoryPlayCookie(res: Response, videoId: string, token: string, exp: number): void {
  const maxAge = Math.max(0, exp * 1000 - Date.now());
  res.cookie(PLAY_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: `/media/hls/${videoId}/`,
    maxAge,
  });
}

/** 微缓存：同一视频的元数据在 HLS 请求里被反复读取，缓存 10 秒显著降低库压。 */
const videoCache = new Map<string, { row: Awaited<ReturnType<typeof findVideoByIdOrSlug>>; expiresAt: number }>();

async function loadVideoCached(videoId: string) {
  const hit = videoCache.get(videoId);
  if (hit && hit.expiresAt > Date.now()) return hit.row;
  const row = await findVideoByIdOrSlug(videoId);
  if (videoCache.size > 500) videoCache.clear();
  videoCache.set(videoId, { row, expiresAt: Date.now() + 10_000 });
  return row;
}

export function invalidateMediaCache(videoId: string): void {
  videoCache.delete(videoId);
}

/**
 * 媒体产物的实际归属者。
 *
 * 秒传克隆出来的视频有自己的 id，但 hls_dir 指向源视频那一份产物，
 * 不能按自己的 id 去找文件；AES 密钥同样由产物归属者派生，否则解不开。
 *
 * 采集转存视频的 hlsDir 形如 hls/collected/{site}/{externalId}，
 * 不是 uuid 目录，返回相对路径段让上层拼出正确 key。
 */
function mediaOwnerId(video: { id: string; hlsDir: string | null }): string {
  const dir = video.hlsDir ?? '';
  const collected = /^hls\/(collected\/[\w.-]+\/[\w.-]+)\/?$/i.exec(dir);
  if (collected) return collected[1]!;
  const match = /^hls\/([0-9a-f-]{36})\/?$/i.exec(dir);
  return match?.[1] ?? video.id;
}

/** 热链入库的采集视频：hlsDir 形如 collected/{site}/{externalId}（无 hls/ 前缀）。 */
function isHotlinkVideo(video: { hlsDir: string | null }): boolean {
  return /^collected\//i.test(video.hlsDir ?? '');
}

/**
 * 每个媒体请求的统一准入：验签 → 查视频 → 复核会员权益 → 并发限流。
 *
 * 关键点在于不信任令牌里的身份快照就放行付费内容：token 只证明「这个请求
 * 来自当初拿到票的那个客户端」，能不能看仍然实时回源判定。
 */
async function authorizeMediaRequest(req: Request, videoId: string) {
  const claims = requirePlayToken(req, videoId);
  const video = await loadVideoCached(videoId);
  if (!video) throw AppError.notFound('视频不存在');

  const userId = claims.userId === 'anon' ? null : claims.userId;

  let isVip = false;
  let isAdmin = false;
  if (userId) {
    const [user] = await db
      .select({ role: t.users.role, vipExpiresAt: t.users.vipExpiresAt, status: t.users.status })
      .from(t.users)
      .where(eq(t.users.id, userId))
      .limit(1);
    if (!user || user.status === 'banned') throw AppError.forbidden('账号状态异常');
    isAdmin = user.role === 'admin';
    isVip = isAdmin || (user.vipExpiresAt !== null && user.vipExpiresAt.getTime() > Date.now());
  }

  const gate = evaluateGate(video, { userId, isVip, isAdmin });
  if (!gate.canPlay) {
    throw gate.gateReason === 'vip_required'
      ? AppError.vipRequired('订阅后即可播放')
      : AppError.forbidden('没有观看权限');
  }

  return { claims, video, userId, isVip, isAdmin };
}

/**
 * 试看边界的服务端兜底。
 *
 * 只靠播放器在 previewSeconds 处暂停是纯客户端约束，改个 JS 就绕过去了。
 * 分片文件名里带序号，乘以分片时长就能算出它覆盖的时间区间，
 * 超出试看范围的分片直接 402——这样即便有人手搓请求也只能拿到前几片。
 */
async function assertWithinPreview(scope: 'full' | 'preview', file: string): Promise<void> {
  if (scope !== 'preview') return;
  // 点播已取消按秒试看，遗留 preview 票一律不给画面分片。
  if (/^init\.(mp4|m4s)$/.test(file)) return;
  throw AppError.vipRequired('订阅后即可播放');
}

function setCors(res: Response): void {
  // 播放器可能跨端口取流，这里放开必要的读取头。
  res.setHeader('Access-Control-Allow-Origin', res.req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}

/**
 * 鉴权通过后把文件交给反代发送。
 *
 * 分片走 Node 的 createReadStream → pipe 会让每一路播放都占着事件循环搬字节，
 * 几百路并发就足以把 API 拖慢到接口超时。X-Accel-Redirect 让 nginx 用 sendfile
 * 直接发本地盘，Range 也由 nginx 处理，Node 这边只剩下鉴权那几毫秒。
 *
 * 只有本地盘驱动能这么做；S3/R2 仍然回落到流式转发。存储配置里的 root 被改到
 * STORAGE_LOCAL_ROOT 之外时也必须回落——反代的 alias 指的是后者，不然会 404。
 */
function tryAccelRedirect(res: Response, storage: Storage, key: string): boolean {
  if (!env.MEDIA_ACCEL_PREFIX) return false;
  if (!storage.localRoot || storage.localRoot !== path.resolve(env.storageRoot)) return false;

  const target = `${env.MEDIA_ACCEL_PREFIX.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  res.setHeader('X-Accel-Redirect', target);
  res.type(contentTypeFor(key));
  res.end();
  return true;
}

// --------------------------------------------------------------------------
// master.m3u8
// --------------------------------------------------------------------------

mediaRouter.get(
  '/hls/:videoId/master.m3u8',
  asyncHandler(async (req, res) => {
    const videoId = req.params.videoId!;
    const { claims, video, userId } = await authorizeMediaRequest(req, videoId);

    const settings = await getSiteSettings();
    await registerStream(
      userId ?? 'anon',
      streamSessionKey(claims),
      settings.maxConcurrentStreams || env.MAX_CONCURRENT_STREAMS,
    );

    // 热链采集视频：不代理视频流，向源站换最新 m3u8 地址后 302。
    // 分片由用户浏览器直接从源站 CDN 拉取（源站 Referer 零检查、地址可多用户共享）。
    if (isHotlinkVideo(video)) {
      const [collected] = await db
        .select({ id: t.collectedVideos.id })
        .from(t.collectedVideos)
        .where(eq(t.collectedVideos.videoId, video.id))
        .limit(1);

      if (collected) {
        const hotlink = HotlinkProxyService.getInstance();
        const { url } = await hotlink.getPlayUrl(collected.id);
        setCors(res);
        res.redirect(302, url);
        return;
      }
      throw AppError.notFound('热链视频源记录缺失');
    }

    const storage = await getStorage();
    const key = `hls/${mediaOwnerId(video)}/master.m3u8`;

    let playlist: string;
    try {
      playlist = (await storage.getBuffer(key)).toString('utf8');
    } catch {
      throw AppError.notFound('播放列表尚未生成，请稍后再试');
    }

    const token = String(req.query[PLAY_TOKEN_PARAM] ?? req.headers['x-play-token'] ?? '');
    setDirectoryPlayCookie(res, videoId, token, claims.exp);
    res.set(MANIFEST_CACHE_HEADERS);
    setCors(res);
    res.type('application/vnd.apple.mpegurl').send(injectTokenIntoPlaylist(playlist, token));
  }),
);

// --------------------------------------------------------------------------
// 分档播放列表与分片
// --------------------------------------------------------------------------

mediaRouter.get(
  '/hls/:videoId/:rendition/index.m3u8',
  asyncHandler(async (req, res) => {
    const videoId = req.params.videoId!;
    const rendition = req.params.rendition!;
    const { claims, video, userId } = await authorizeMediaRequest(req, videoId);

    const settings = await getSiteSettings();
    await registerStream(
      userId ?? 'anon',
      streamSessionKey(claims),
      settings.maxConcurrentStreams || env.MAX_CONCURRENT_STREAMS,
    );

    const storage = await getStorage();
    const key = sanitizeKey(`hls/${mediaOwnerId(video)}/${rendition}/index.m3u8`);

    let playlist: string;
    try {
      playlist = (await storage.getBuffer(key)).toString('utf8');
    } catch {
      throw AppError.notFound('该清晰度暂不可用');
    }

    const token = String(req.query[PLAY_TOKEN_PARAM] ?? req.headers['x-play-token'] ?? '');
    setDirectoryPlayCookie(res, videoId, token, claims.exp);
    res.set(MANIFEST_CACHE_HEADERS);
    setCors(res);
    res
      .type('application/vnd.apple.mpegurl')
      .send(injectTokenIntoPlaylist(rewriteKeyUri(playlist, video.id), token));
  }),
);

mediaRouter.get(
  '/hls/:videoId/:rendition/:file',
  asyncHandler(async (req, res) => {
    const videoId = req.params.videoId!;
    const { rendition, file } = req.params as { rendition: string; file: string };

    if (!/^[\w.-]+$/.test(rendition) || !/^[\w.-]+\.(m4s|mp4|ts|m4a)$/.test(file)) {
      throw AppError.badRequest('非法的分片路径');
    }

    const { video, claims } = await authorizeMediaRequest(req, videoId);
    await assertWithinPreview(claims.scope, file);

    const storage = await getStorage();
    const key = sanitizeKey(`hls/${mediaOwnerId(video)}/${rendition}/${file}`);

    setCors(res);
    res.set(SEGMENT_CACHE_HEADERS);
    res.setHeader('Accept-Ranges', 'bytes');

    if (tryAccelRedirect(res, storage, key)) return;

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const meta = await storage.head(key);
      if (!meta) throw AppError.notFound('分片不存在');
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : meta.size - 1;

      const result = await storage.get(key, { start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
      res.setHeader('Content-Length', String(result.size));
      res.type(result.contentType);
      result.stream.pipe(res);
      return;
    }

    const result = await storage.get(key);
    res.setHeader('Content-Length', String(result.size));
    res.type(result.contentType);
    result.stream.on('error', (error) => {
      logger.warn({ err: error, key }, '分片读取中断');
      res.destroy();
    });
    result.stream.pipe(res);
  }),
);

// --------------------------------------------------------------------------
// HLS AES-128 密钥
// --------------------------------------------------------------------------

/**
 * 会员视频的内容密钥。密钥由 HLS_KEY_SECRET + videoId 派生，不落库；
 * 取密钥与取分片走完全相同的鉴权，所以拿不到密钥就解不开分片。
 */
mediaRouter.get(
  '/hls/:videoId/key',
  asyncHandler(async (req, res) => {
    const videoId = req.params.videoId!;
    const { video } = await authorizeMediaRequest(req, videoId);

    if (!video.isEncrypted) throw AppError.notFound('该视频未加密');

    const key = deriveHlsContentKey(mediaOwnerId(video), env.HLS_KEY_SECRET);
    setCors(res);
    res.set({ 'Cache-Control': 'no-store, private' });
    res.type('application/octet-stream').send(key);
  }),
);

// --------------------------------------------------------------------------
// 缩略图雪碧图 / 封面等公开静态资源
// --------------------------------------------------------------------------

mediaRouter.get(
  '/assets/:videoId/:file',
  asyncHandler(async (req, res) => {
    const { videoId, file } = req.params as { videoId: string; file: string };
    if (!/^[\w.-]+\.(jpg|jpeg|png|webp|avif|vtt|srt|mp4)$/.test(file)) {
      throw AppError.badRequest('非法的资源路径');
    }

    const storage = await getStorage();
    const key = sanitizeKey(`assets/${videoId}/${file}`);

    setCors(res);
    // 封面与雪碧图内容不变，可以放心长缓存。
    res.set({ 'Cache-Control': 'public, max-age=604800, immutable' });

    if (tryAccelRedirect(res, storage, key)) return;

    const result = await storage.get(key);
    res.setHeader('Content-Length', String(result.size));
    res.type(result.contentType);
    result.stream.pipe(res);
  }),
);
