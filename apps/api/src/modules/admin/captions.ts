import { AppError } from '../../core/errors.js';
import type { CaptionFormat } from '@videox/shared';

export const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2})?$/;
const SRT_TS = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;
const VTT_TS = /\d{1,2}:\d{2}(?::\d{2})?[.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.]\d{1,3}/;

export function captionFormatOf(filename: string): CaptionFormat {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'vtt' || ext === 'srt') return ext;
  throw AppError.badRequest('只支持 VTT 或 SRT 字幕');
}

export function normalizeCaptionLang(lang: string): string {
  const value = lang.trim();
  if (!LANG_RE.test(value)) throw AppError.badRequest('语言代码不正确');
  return value;
}

export function assertCaptionContent(format: CaptionFormat, content: string): void {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) throw AppError.badRequest('字幕文件不能为空');
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
