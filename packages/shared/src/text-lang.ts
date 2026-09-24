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

// --------------------------------------------------------------------------
// 首页推荐：标题语种
// --------------------------------------------------------------------------

/**
 * 推荐排序里可配置的标题语种。
 *
 * 比 {@link CONTENT_LANGS} 多出 `zh-Hant`：首页推荐要按「中文 / 繁体中文 / 日文」
 * 分别加权，而简体与繁体都落在汉字区段，靠字符集本身分不开，必须再看一遍
 * {@link TRADITIONAL_ONLY_CHARS} 里的繁体专用字。
 */
export const TITLE_LANGS = ['zh', 'zh-Hant', 'ja', 'ko', 'th', 'en'] as const;
export type TitleLang = (typeof TITLE_LANGS)[number];

/** 后台界面的语种名。顺序即展示顺序。 */
export const TITLE_LANG_LABELS: Record<TitleLang, string> = {
  zh: '中文（简体）',
  'zh-Hant': '中文（繁体）',
  ja: '日文',
  ko: '韩文',
  th: '泰文',
  en: '英文',
};

/**
 * 只在繁体里出现、简体写法一定不同的常用字。
 *
 * 这张表宁可少收也不能多收：里面混进一个简繁同形的字（「在」「狗」「姐」「傅」「窗」），
 * 全站就会有一大批简体标题被误判成繁体。所以只收真正只有繁体写法的那一个字形，
 * 常见字优先——标题里命中一个字就足以定性，覆盖不到的生僻字被当成简体也无妨
 * （两者默认权重本来就相同）。
 */
export const TRADITIONAL_ONLY_CHARS =
  '體愛萬這個們說來時為國開會對發與從經點區歲藝樂實還嗎麼樣東門見語話買賣聽讀寫覺謝讓認識記論談議課誰請問間關長聞靜頭題類風飛馬鳥魚龍龜雞鴨鵝豬貓爺媽師務員鐵銀銅鋼紙筆車' +
  '產業習練戰變場無過現網錢頂順幾兒圖團學寶將應數斷構標權歡辭醫釋錯鎖錄鏡鐘陽陰際陳階隨隱難雲韓項預領願顧顯飄驚驗髮鬥鮮麗黃齊純織綠紅線緊緩縣總續賽購費質資責貴輕載轉較輛輩農邊進遠適選遺郵鄉';

const TRADITIONAL_ONLY = new RegExp(`[${TRADITIONAL_ONLY_CHARS}]`);

/**
 * 未配置时的语种权重：中文 / 繁体中文 / 日文升权，纯英文降权，其余不参与。
 *
 * 迁移里播种的就是这份表，后台改过之后以库里的为准。权重是「加到排序分上的值」，
 * 正数靠前、负数靠后，0 等于不管。
 */
export const TITLE_LANG_DEFAULT_RULES: ReadonlyArray<{
  lang: TitleLang;
  direction: 'boost' | 'penalty';
  weight: number;
}> = [
  { lang: 'zh', direction: 'boost', weight: 1.5 },
  { lang: 'zh-Hant', direction: 'boost', weight: 1.5 },
  { lang: 'ja', direction: 'boost', weight: 1.5 },
  { lang: 'en', direction: 'penalty', weight: 1 },
];

/**
 * 标题主语种判定，供首页推荐的语种加权使用。
 *
 * 与 {@link detectContentLang} 的两点差别：
 * 1. 先看假名再看汉字——日文标题常常「汉字 + 假名」混排，按汉字先判会整片误判成中文；
 * 2. 汉字里再分繁简，繁体专用字命中即 `zh-Hant`。
 *
 * 纯符号 / 纯数字 / 空串返回 null，由调用方决定兜底（排序里视作不是任何语种）。
 */
export function detectTitleLang(...texts: Array<string | null | undefined>): TitleLang | null {
  for (const raw of texts) {
    const text = (raw ?? '').trim();
    if (!text) continue;
    if (HIRAGANA_KATAKANA.test(text)) return 'ja';
    if (HANGUL.test(text)) return 'ko';
    if (THAI.test(text)) return 'th';
    if (TRADITIONAL_ONLY.test(text)) return 'zh-Hant';
    if (HAN.test(text)) return 'zh';
    if (LATIN_LETTER.test(text)) return 'en';
  }
  return null;
}
