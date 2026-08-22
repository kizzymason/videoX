import { describe, expect, it } from 'vitest';
import {
  compactRedeemCode,
  generateCodesSchema,
  normalizeRedeemInput,
  normalizeRedeemPrefix,
  REDEEM_CODE_LENGTH,
  redeemSchema,
} from '@videox/shared';
import { generateCode } from '../apps/api/src/modules/membership/codes.ts';

describe('卡密格式：12 位大写字母数字', () => {
  it('无前缀时整码正好 12 位，且不含连字符', () => {
    const code = generateCode();
    expect(code).toHaveLength(REDEEM_CODE_LENGTH);
    expect(code).toMatch(/^[A-Z0-9]{12}$/);
    expect(code.includes('-')).toBe(false);
  });

  it('3 位前缀时前缀在前，总长仍是 12', () => {
    const code = generateCode('vip');
    expect(code).toHaveLength(12);
    expect(code.startsWith('VIP')).toBe(true);
    expect(code).toMatch(/^VIP[A-Z0-9]{9}$/);
  });

  it('前缀只保留大写字母数字', () => {
    expect(normalizeRedeemPrefix(' vip-1 ')).toBe('VIP1');
    expect(generateCode('ab')).toMatch(/^AB[A-Z0-9]{10}$/);
  });

  it('后台前缀最多 8 位，拒绝更长或非法字符', () => {
    expect(generateCodesSchema.parse({ planId: '00000000-0000-0000-0000-000000000001', count: 1, prefix: 'vip' }).prefix).toBe(
      'VIP',
    );
    expect(() =>
      generateCodesSchema.parse({ planId: '00000000-0000-0000-0000-000000000001', count: 1, prefix: 'TOOLONGXX' }),
    ).toThrow();
    expect(() =>
      generateCodesSchema.parse({ planId: '00000000-0000-0000-0000-000000000001', count: 1, prefix: 'V-1' }),
    ).toThrow();
  });

  it('兑换入参去掉空格并转大写，不自动插入连字符', () => {
    expect(redeemSchema.parse({ code: '  vipabc123xy ' }).code).toBe('VIPABC123XY');
    expect(normalizeRedeemInput('vip abc 123')).toBe('VIPABC123');
    expect(compactRedeemCode('VIP-ABC-123')).toBe('VIPABC123');
  });
});
