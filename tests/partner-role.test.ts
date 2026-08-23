import { describe, expect, it } from 'vitest';
import {
  generatePartnerCodesSchema,
  isComplimentaryVip,
  partnerLevelLabel,
  USER_ROLES,
} from '@videox/shared';

describe('合伙人角色与校验', () => {
  it('角色枚举包含 partner，且自带会员', () => {
    expect(USER_ROLES).toContain('partner');
    expect(isComplimentaryVip('partner')).toBe(true);
    expect(isComplimentaryVip('admin')).toBe(true);
    expect(isComplimentaryVip('user')).toBe(false);
    expect(isComplimentaryVip('vip')).toBe(false);
  });

  it('等级文案用合伙人而不是代理商', () => {
    expect(partnerLevelLabel('standard')).toBe('普通合伙人');
    expect(partnerLevelLabel('plus')).toBe('核心合伙人');
  });

  it('生成订阅码单次最多 200 张，售价与天数必填', () => {
    expect(generatePartnerCodesSchema.parse({ days: 30, count: 2, salePriceYuan: 19 })).toMatchObject({
      days: 30,
      count: 2,
      salePriceYuan: 19,
    });
    expect(() => generatePartnerCodesSchema.parse({ days: 30, count: 201, salePriceYuan: 19 })).toThrow();
    expect(() => generatePartnerCodesSchema.parse({ days: 0, count: 1, salePriceYuan: 19 })).toThrow();
  });
});
