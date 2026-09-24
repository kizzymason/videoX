/**
 * 文本主语言粗判。
 *
 * 只按字符集判断，不做词法分析——用途是给 `<html lang>` 这类标注一个比写死更准的值。
 * 站内标题来自多个片源，中文、英文、日文、泰文混在一起，全站写死 zh-CN 对那一万多个
 * 纯英文标题的页面是错的。注意 Google 判断页面语言主要看可见内容而非 lang 属性，
 * 所以这件事的收益在无障碍朗读、浏览器翻译提示与其他搜索引擎，不是排名。
 */

export const CONTENT_LANGS = ['zh', 'ja', 'ko', 'th', 'en'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

/** 站点 UI 语言：导航、页脚这些固定文案的语言，也是判不出来时的兜底。 */
export const SITE_UI_LANG = 'zh-CN';

// 假名要排在汉字之前判断：日文标题往往汉字 + 假名混排，先看汉字会误判成中文。
const HIRAGANA_KATAKANA = /[\u3040-\u30ff]/;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/;
const THAI = /[\u0e00-\u0e7f]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_LETTER = /[A-Za-z]/;

/**
 * 依次尝试给定的文本片段（标题优先、描述兜底），返回第一个能判出语言的结果。
 * 全部判不出来（纯数字 / 纯符号 / 空）时返回 null，由调用方决定兜底值。
 */
export function detectContentLang(...texts: Array<string | null | undefined>): ContentLang | null {
  for (const raw of texts) {
    const text = (raw ?? '').trim();
    if (!text) continue;
    if (HIRAGANA_KATAKANA.test(text)) return 'ja';
    if (HANGUL.test(text)) return 'ko';
    if (THAI.test(text)) return 'th';
    if (HAN.test(text)) return 'zh';
    if (LATIN_LETTER.test(text)) return 'en';
  }
  return null;
}

/** 给 `<html lang>` 用的 BCP-47 标签，判不出来时回落到站点 UI 语言。 */
export function resolveHtmlLang(...texts: Array<string | null | undefined>): string {
  return detectContentLang(...texts) ?? SITE_UI_LANG;
}
