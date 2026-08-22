/** 新卡密固定 12 位大写字母 + 数字，中间不加连字符。 */
export const REDEEM_CODE_LENGTH = 12;
/** 前缀一般为 3 位，最多留 4 位随机段以免碰撞。 */
export const REDEEM_CODE_PREFIX_MAX = 8;
export const REDEEM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function normalizeRedeemInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function compactRedeemCode(raw: string): string {
  return normalizeRedeemInput(raw).replace(/-/g, '');
}

export function normalizeRedeemPrefix(prefix?: string | null): string {
  return (prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
