import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { uploadCaptionSchema } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { asyncHandler, ok } from '../../core/respond.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { body, params, validate } from '../../middleware/validate.js';
import { requireVideo } from '../videos/service.js';
import { getStorage } from '../storage/service.js';
import { StorageKeys } from '../storage/keys.js';
import { audit } from './audit.js';
import {
  assertCaptionContent,
  captionFormatOf,
  captionLabel,
  captionPublicUrl,
  normalizeCaptionLanguage,
  type CaptionTrack,
} from './captions.js';

export const captionRouter: Router = Router();

captionRouter.use(requireAuth, requireAdmin);

const idParam = z.object({ id: z.string().min(1).max(64) });
const captionParam = z.object({
  id: z.string().min(1).max(64),
  language: z.string().min(2).max(16),
});

function publicTracks(tracks: CaptionTrack[]): Array<Pick<CaptionTrack, 'language' | 'label' | 'format' | 'url'>> {
  return tracks.map((c) => ({ language: c.language, label: c.label, format: c.format, url: c.url }));
}

captionRouter.get(
  '/videos/:id/captions',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const video = await requireVideo(params<{ id: string }>(req).id);
    ok(res, publicTracks((video.captions ?? []) as CaptionTrack[]));
  }),
);

captionRouter.post(
  '/videos/:id/captions',
  validate({ params: idParam, body: uploadCaptionSchema }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<{ language: string; label?: string; filename: string; content: string }>(req);
    const video = await requireVideo(id);

    const format = captionFormatOf(input.filename);
    const language = normalizeCaptionLanguage(input.language);
    assertCaptionContent(format, input.content);

    const key = StorageKeys.caption(video.id, language, format);
    const url = captionPublicUrl(video.id, language, format);
    const track: CaptionTrack = {
      language,
      label: captionLabel(language, input.label),
      format,
      key,
      url,
    };

    const storage = await getStorage();
    await storage.put(key, Buffer.from(input.content, 'utf8'), format === 'vtt' ? 'text/vtt' : 'application/x-subrip');

    const next = ((video.captions ?? []) as CaptionTrack[]).filter((c) => c.language !== language);
    next.push(track);

    await db.update(t.videos).set({ captions: next, updatedAt: new Date() }).where(eq(t.videos.id, video.id));
    await audit(req, 'video.caption.upload', { type: 'video', id: video.id }, { language, format });
    ok(res, publicTracks(next), '字幕已上传');
  }),
);

captionRouter.delete(
  '/videos/:id/captions/:language',
  validate({ params: captionParam }),
  asyncHandler(async (req, res) => {
    const { id, language } = params<{ id: string; language: string }>(req);
    const video = await requireVideo(id);
    const lang = normalizeCaptionLanguage(language);
    const current = (video.captions ?? []) as CaptionTrack[];
    const hit = current.find((c) => c.language === lang);
    if (!hit) throw AppError.notFound('该语言字幕不存在');

    const storage = await getStorage();
    await storage.delete(hit.key).catch(() => undefined);

    const next = current.filter((c) => c.language !== lang);
    await db.update(t.videos).set({ captions: next, updatedAt: new Date() }).where(eq(t.videos.id, video.id));
    await audit(req, 'video.caption.delete', { type: 'video', id: video.id }, { language: lang });
    ok(res, publicTracks(next), '字幕已删除');
  }),
);
