const KNOWN = new Set(['zh', 'en', 'ja', 'ko']);
const KNOWN_REGION = new Set(['zh-cn', 'zh-tw']);

/** 从 `movie.zh-CN.srt` 这类文件名猜语言，猜不到就中文。 */
export function guessCaptionLang(filename: string): string {
  const base = filename.replace(/\.(vtt|srt)$/i, '').toLowerCase();
  const region = base.match(/(?:^|[._-])([a-z]{2,3}-[a-z]{2})$/);
  if (region?.[1] && KNOWN_REGION.has(region[1])) {
    const [lang, area] = region[1].split('-');
    return `${lang}-${area.toUpperCase()}`;
  }
  const simple = base.match(/(?:^|[._-])([a-z]{2,3})$/);
  if (simple?.[1] && KNOWN.has(simple[1])) return simple[1];
  return 'zh';
}
