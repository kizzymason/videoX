import { AppError } from '../../core/errors.js';

export const CAPTION_FORMATS = ['vtt', 'srt'] as const;
export type CaptionFormat = (typeof CAPTION_FORMATS)[number];

export interface CaptionTrack {
  language: string;
  label: string;
  format: CaptionFormat;
  key: string;
  url: string;
}

const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2})?$/;
const SRT_TS = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
const VTT_TS = /\d{1,2}:\d{2}(?::\d{2})?[.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.]\d{1,3}/;

export function captionFormatOf(filename: string): CaptionFormat {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'vtt' || ext === 'srt') return ext;
  throw AppError.badRequest('只支持 VTT 或 SRT 字幕');
}

export function normalizeCaptionLanguage(language: string): string {
  const lang = language.trim();
  if (!LANG_RE.test(lang)) throw AppError.badRequest('语言代码不正确');
  return lang;
}

export function assertCaptionContent(format: CaptionFormat, content: string): void {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) throw AppError.badRequest('字幕内容为空');
  if (format === 'vtt') {
    if (!text.startsWith('WEBVTT') && !VTT_TS.test(text)) {
      throw AppError.badRequest('不是有效的 VTT 字幕');
    }
    return;
  }
  if (!SRT_TS.test(text)) {
    throw AppError.badRequest('不是有效的 SRT 字幕');
  }
}

export function captionPublicUrl(videoId: string, language: string, format: CaptionFormat): string {
  return `/media/assets/${videoId}/caption-${language}.${format}`;
}

export function captionLabel(language: string, label?: string): string {
  const trimmed = label?.trim();
  return trimmed || language;
}
