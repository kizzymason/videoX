import { describe, expect, it } from 'vitest';
import {
  assertCaptionContent,
  captionFormatOf,
  captionPublicUrl,
  normalizeCaptionLanguage,
} from '../apps/api/src/modules/admin/captions.ts';

describe('字幕只收 VTT/SRT', () => {
  it('扩展名只允许 vtt/srt', () => {
    expect(captionFormatOf('zh.vtt')).toBe('vtt');
    expect(captionFormatOf('en.SRT')).toBe('srt');
    expect(() => captionFormatOf('notes.txt')).toThrow();
    expect(() => captionFormatOf('ass.ass')).toThrow();
  });

  it('VTT 必须带 WEBVTT 或时间轴', () => {
    expect(() => assertCaptionContent('vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi')).not.toThrow();
    expect(() => assertCaptionContent('vtt', 'this is not a caption')).toThrow();
  });

  it('SRT 必须带时间轴', () => {
    expect(() =>
      assertCaptionContent('srt', '1\n00:00:00,000 --> 00:00:01,000\nhello'),
    ).not.toThrow();
    expect(() => assertCaptionContent('srt', 'just text')).toThrow();
  });

  it('空内容 400', () => {
    expect(() => assertCaptionContent('vtt', '   ')).toThrow();
  });

  it('详情地址落在 /media/assets', () => {
    expect(captionPublicUrl('vid', 'zh', 'vtt')).toBe('/media/assets/vid/caption-zh.vtt');
  });

  it('语言代码校验', () => {
    expect(normalizeCaptionLanguage('zh')).toBe('zh');
    expect(normalizeCaptionLanguage('zh-CN')).toBe('zh-CN');
    expect(() => normalizeCaptionLanguage('中文')).toThrow();
  });
});
