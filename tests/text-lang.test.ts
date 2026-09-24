import { describe, expect, it } from 'vitest';
import { SITE_UI_LANG, detectContentLang, resolveHtmlLang } from '../packages/shared/src/index.ts';

describe('内容语言判定', () => {
  it('用线上真实标题验证各语种', () => {
    // 库里 43376 条含汉字、8583 条纯 ASCII、607 条泰文，下面各取真实样本
    expect(detectContentLang('三秒-017 大天使的氣息 治癒他的不舉吧！')).toBe('zh');
    expect(detectContentLang('黑皮肌肉教练-艺术摄影棚的故事')).toBe('zh');
    expect(detectContentLang('MEN – Malik Delgaty & Jackson Cooks')).toBe('en');
    expect(detectContentLang('Kuupid-sneaky but sexy')).toBe('en');
    expect(detectContentLang('ดูเขาเสวกัน')).toBe('th');
  });

  it('日文汉字混假名要判成日文，不能被汉字规则抢先', () => {
    expect(detectContentLang('無修正 かわいい男の子')).toBe('ja');
    expect(detectContentLang('ドキュメント')).toBe('ja');
  });

  it('韩文', () => {
    expect(detectContentLang('한국 남자')).toBe('ko');
  });

  it('标题判不出来时用描述兜底', () => {
    expect(detectContentLang('2026-09-01', 'A hot summer night in Madrid')).toBe('en');
    expect(detectContentLang('', '国产自拍')).toBe('zh');
  });

  it('纯数字/符号/空返回 null，交给调用方兜底', () => {
    expect(detectContentLang('123-456')).toBeNull();
    expect(detectContentLang('')).toBeNull();
    expect(detectContentLang(null, undefined)).toBeNull();
  });

  it('resolveHtmlLang 判不出来时回落到站点 UI 语言', () => {
    expect(resolveHtmlLang('Peak-ep.14-2')).toBe('en');
    expect(resolveHtmlLang('123')).toBe(SITE_UI_LANG);
    expect(SITE_UI_LANG).toBe('zh-CN');
  });
});
