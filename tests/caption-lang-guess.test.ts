import { describe, expect, it } from 'vitest';
import { guessCaptionLang } from '../apps/admin/src/lib/caption-lang.ts';

describe('管理端字幕文件名猜语言', () => {
  it('从扩展名前的语言码取值', () => {
    expect(guessCaptionLang('zh.srt')).toBe('zh');
    expect(guessCaptionLang('en.vtt')).toBe('en');
    expect(guessCaptionLang('movie.zh-CN.srt')).toBe('zh-CN');
    expect(guessCaptionLang('clip.en.VTT')).toBe('en');
  });

  it('猜不到就中文', () => {
    expect(guessCaptionLang('subtitle.srt')).toBe('zh');
    expect(guessCaptionLang('notes.txt')).toBe('zh');
    expect(guessCaptionLang('video-id.srt')).toBe('zh');
  });
});
