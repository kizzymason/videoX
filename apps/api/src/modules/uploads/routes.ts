import { Router } from 'express';
import { UPLOAD_CHUNK_SIZE, uploadCompleteSchema, uploadInitSchema } from '@videox/shared';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { body, validate } from '../../middleware/validate.js';
import {
  abortUpload,
  completeUpload,
  finalizeInstantUpload,
  getUploadSession,
  initUpload,
  receiveChunk,
  toUploadSession,
} from './service.js';

export const uploadsRouter: Router = Router();

uploadsRouter.use(requireAuth, requireAdmin);

uploadsRouter.post(
  '/init',
  validate({ body: uploadInitSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      filename: string;
      fileSize: number;
      chunkSize: number;
      fileHash?: string;
      mimeType?: string;
    }>(req);

    const chunkSize = input.chunkSize || UPLOAD_CHUNK_SIZE;
    const totalChunks = Math.ceil(input.fileSize / chunkSize);

    const result = await initUpload({
      userId: req.auth!.id,
      filename: input.filename,
      fileSize: input.fileSize,
      chunkSize,
      totalChunks,
      fileHash: input.fileHash,
      mimeType: input.mimeType,
    });

    ok(res, {
      ...result.session,
      chunkSize,
      totalChunks,
      existingVideoId: result.existingVideoId,
    });
  }),
);

uploadsRouter.get(
  '/:uploadId',
  asyncHandler(async (req, res) => {
    const session = await getUploadSession(req.params.uploadId!, req.auth!.id);
    ok(res, toUploadSession(session));
  }),
);

/**
 * 分片以裸二进制 body 上传（application/octet-stream），
 * 不走 multipart，省掉一次内存拷贝与边界解析。
 */
uploadsRouter.put(
  '/:uploadId/part/:index',
  asyncHandler(async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw AppError.badRequest('分片序号非法');

    const expectedHash = typeof req.headers['x-chunk-sha256'] === 'string' ? req.headers['x-chunk-sha256'] : undefined;

    const result = await receiveChunk({
      uploadId: req.params.uploadId!,
      userId: req.auth!.id,
      index,
      stream: req,
      expectedHash,
    });

    ok(res, {
      index,
      receivedCount: result.received.length,
      complete: result.complete,
    });
  }),
);

uploadsRouter.post(
  '/:uploadId/complete',
  validate({ body: uploadCompleteSchema }),
  asyncHandler(async (req, res) => {
    const input = body<{
      title?: string;
      description?: string;
      categoryId?: string | null;
      tags?: string[];
      accessLevel: 'vip',
      visibility: 'public' | 'unlisted' | 'private';
      kind?: 'vod' | 'shorts';
    }>(req);

    const session = await getUploadSession(req.params.uploadId!, req.auth!.id);
    const accessLevel = 'vip' as const;

    // 秒传路径：init 阶段已判定命中，这里只在同档时克隆产物，跨档按新档重转。
    if (session.status === 'completed' && !session.tempDir && session.fileHash) {
      const result = await finalizeInstantUpload({
        sourceVideoId: session.videoId ?? '',
        userId: req.auth!.id,
        ...input,
        accessLevel,
      });
      ok(
        res,
        { videoId: result.videoId, jobId: result.jobId, instant: result.instant },
        result.instant ? '秒传完成' : '档位不同，已按新档入队转码',
      );
      return;
    }

    const result = await completeUpload({
      uploadId: req.params.uploadId!,
      userId: req.auth!.id,
      ...input,
      accessLevel,
    });
    ok(res, { ...result, instant: false }, '上传完成，已进入转码队列');
  }),
);

uploadsRouter.post(
  '/:uploadId/abort',
  asyncHandler(async (req, res) => {
    await abortUpload(req.params.uploadId!, req.auth!.id);
    ok(res, null, '上传已取消');
  }),
);
