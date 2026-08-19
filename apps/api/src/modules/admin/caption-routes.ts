import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { uploadCaptionSchema } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, params, validate } from '../../middleware/validate.js';
import { listCaptionTracks, requireVideo } from '../videos/service.js';
import { getStorage } from '../storage/service.js';
import { StorageKeys } from '../storage/keys.js';
import { audit } from './audit.js';
import { assertCaptionContent, captionFormatOf, normalizeCaptionLang } from './captions.js';

export const captionRouter: Router = Router();

captionRouter.use(requireAuth, requireAdmin);

const idParam = z.object({ id: z.string().min(1).max(64) });
const captionParam = z.object({
  id: z.string().min(1).max(64),
  lang: z.string().min(2).max(16),
});

captionRouter.get(
  '/videos/:id/captions',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const video = await requireVideo(params<{ id: string }>(req).id);
    ok(res, await listCaptionTracks(video.id));
  }),
);

captionRouter.post(
  '/videos/:id/captions',
  validate({ params: idParam, body: uploadCaptionSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<{ lang: string; filename: string; content: string }>(req);
    const video = await requireVideo(id);

    const format = captionFormatOf(input.filename);
    const lang = normalizeCaptionLang(input.lang);
    assertCaptionContent(format, input.content);

    const storageKey = StorageKeys.caption(video.id, lang, format);
    const storage = await getStorage();
    await storage.put(storageKey, Buffer.from(input.content, 'utf8'), format === 'vtt' ? 'text/vtt' : 'application/x-subrip');

    const [existing] = await db
      .select()
      .from(t.videoCaptions)
      .where(and(eq(t.videoCaptions.videoId, video.id), eq(t.videoCaptions.lang, lang)))
      .limit(1);

    if (existing) {
      if (existing.storageKey !== storageKey) {
        await storage.delete(existing.storageKey).catch(() => undefined);
      }
      await db
        .update(t.videoCaptions)
        .set({ format, storageKey, updatedAt: new Date() })
        .where(eq(t.videoCaptions.id, existing.id));
    } else {
      await db.insert(t.videoCaptions).values({ videoId: video.id, lang, format, storageKey });
    }

    await audit(req, 'video.caption.upload', { type: 'video', id: video.id }, { lang, format });
    ok(res, await listCaptionTracks(video.id), '字幕已上传');
  }),
);

captionRouter.delete(
  '/videos/:id/captions/:lang',
  validate({ params: captionParam }),
  asyncHandler(async (req, res) => {
    const { id, lang: rawLang } = params<{ id: string; lang: string }>(req);
    const video = await requireVideo(id);
    const lang = normalizeCaptionLang(rawLang);
    const [hit] = await db
      .select()
      .from(t.videoCaptions)
      .where(and(eq(t.videoCaptions.videoId, video.id), eq(t.videoCaptions.lang, lang)))
      .limit(1);
    if (!hit) throw AppError.notFound('该语言字幕不存在');

    const storage = await getStorage();
    await storage.delete(hit.storageKey).catch(() => undefined);
    await db.delete(t.videoCaptions).where(eq(t.videoCaptions.id, hit.id));
    await audit(req, 'video.caption.delete', { type: 'video', id: video.id }, { lang });
    ok(res, await listCaptionTracks(video.id), '字幕已删除');
  }),
);
