import { describe, expect, it } from 'vitest';
import {
  SITE_UI_LANG,
  TITLE_LANGS,
  TITLE_LANG_DEFAULT_RULES,
  TITLE_LANG_LABELS,
  TRADITIONAL_ONLY_CHARS,
  detectContentLang,
  detectTitleLang,
  resolveHtmlLang,
} from '../packages/shared/src/index.ts';

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

describe('首页推荐的标题语种判定', () => {
  it('用线上真实标题分别验证六个语种', () => {
    // 期望值来自人工核对，样本都是线上实际存在的标题
    expect(detectTitleLang('游泳池勾引直男')).toBe('zh');
    expect(detectTitleLang('记者系列-华南理工大学 黄XX')).toBe('zh');
    expect(detectTitleLang('超愛那種可愛又粉嫩的大屌!! 弟弟今年要升大一了')).toBe('zh-Hant');
    expect(detectTitleLang('直男獵手 DK (fpbnee1541641) – 雙飛紋身直男')).toBe('zh-Hant');
    expect(detectTitleLang('BOYS.BANK – BOB-185 – 激カワマッシュのチェリーボーイ♪')).toBe('ja');
    expect(detectTitleLang('HUNK CHANNEL – CR-0942 – ソクハメ!!vol.792 夏ハメ')).toBe('ja');
    expect(detectTitleLang('ตัวเล็กงับ')).toBe('th');
    expect(detectTitleLang('BarebackLatinoz Volume 2')).toBe('en');
    expect(detectTitleLang('MC – CONRAD4 – BLOWJOB-FLESHLIGHT')).toBe('en');
  });

  it('日文标题的汉字不能被汉字规则抢走', () => {
    // 混排：汉字 + 假名，必须判日文
    expect(detectTitleLang('無修正 かわいい男の子')).toBe('ja');
    expect(detectTitleLang('ドキュメント')).toBe('ja');
    // 纯汉字、又不含繁体字的日文标题会落进中文，这是纯字符集方案的固有边界。
    // 无害：中文与日文在默认规则里权重相同，排序结果一样。
    expect(detectTitleLang('東京')).toBe('zh-Hant');
  });

  it('繁体专用字表里不能混进简繁同形的字', () => {
    // 这几个字简繁写法完全相同，混进表里会让整片简体标题被误判成繁体
    for (const shared of ['在', '狗', '姐', '傅', '窗', '的', '一', '是']) {
      expect(TRADITIONAL_ONLY_CHARS.includes(shared)).toBe(false);
    }
    // 表里不应有重复字符
    expect(new Set([...TRADITIONAL_ONLY_CHARS]).size).toBe([...TRADITIONAL_ONLY_CHARS].length);
  });

  it('只含简体的标题不会被误判成繁体', () => {
    expect(detectTitleLang('健身房猛男被绑在器械上 道具猛插强受喷射失控')).toBe('zh');
    expect(detectTitleLang('椰子水-被主人在楼道调教')).toBe('zh');
    expect(detectTitleLang('柳乃堂-操小鲜肉')).toBe('zh');
  });

  it('判不出语种返回 null，由排序视作中立', () => {
    expect(detectTitleLang('2026-09-01')).toBeNull();
    expect(detectTitleLang('12345')).toBeNull();
    expect(detectTitleLang('')).toBeNull();
    expect(detectTitleLang(null, undefined)).toBeNull();
  });

  it('标题为空时用描述兜底', () => {
    expect(detectTitleLang('', '国产自拍')).toBe('zh');
    expect(detectTitleLang('  ', 'A hot summer night in Madrid')).toBe('en');
  });

  it('默认规则覆盖了需求里点名的三类语种', () => {
    // 需求：中文 / 繁体中文 / 日文加权，纯英语降权
    for (const lang of ['zh', 'zh-Hant', 'ja'] as const) {
      const rule = TITLE_LANG_DEFAULT_RULES.find((item) => item.lang === lang);
      expect(rule?.direction).toBe('boost');
      expect(rule?.weight).toBeGreaterThan(0);
    }
    expect(TITLE_LANG_DEFAULT_RULES.find((item) => item.lang === 'en')?.direction).toBe('penalty');
  });

  it('每个语种都有中文名，枚举与默认值互相自洽', () => {
    expect(TITLE_LANGS).toHaveLength(6);
    for (const lang of TITLE_LANGS) {
      expect(TITLE_LANG_LABELS[lang]).toBeTruthy();
    }
    for (const rule of TITLE_LANG_DEFAULT_RULES) {
      expect(TITLE_LANGS).toContain(rule.lang);
    }
  });

  it('detectContentLang 的行为不受标题语种判定影响', () => {
    // SEO 那边依赖 zh / en 这类粗粒度结果，不能被新增的 zh-Hant 改动
    expect(detectContentLang('超愛那種可愛又粉嫩的大屌')).toBe('zh');
  });
});
