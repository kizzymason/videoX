import { randomInt } from 'node:crypto';
import {
  normalizeRedeemPrefix,
  REDEEM_CODE_ALPHABET,
  REDEEM_CODE_LENGTH,
  REDEEM_CODE_PREFIX_MAX,
} from '@videox/shared';
import { AppError } from '../../core/errors.js';

export function randomSegment(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += REDEEM_CODE_ALPHABET[randomInt(REDEEM_CODE_ALPHABET.length)];
  return out;
}

/** 生成 12 位卡密：前缀（一般为 3 位）+ 随机段，全大写字母数字，中间不加连字符。 */
export function generateCode(prefix?: string): string {
  const cleanPrefix = normalizeRedeemPrefix(prefix);
  if (cleanPrefix.length > REDEEM_CODE_PREFIX_MAX) {
    throw AppError.badRequest(`前缀最多 ${REDEEM_CODE_PREFIX_MAX} 位，整码共 ${REDEEM_CODE_LENGTH} 位`);
  }
  return `${cleanPrefix}${randomSegment(REDEEM_CODE_LENGTH - cleanPrefix.length)}`;
}
