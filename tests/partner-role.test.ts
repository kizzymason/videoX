import { describe, expect, it } from 'vitest';
import {
  generateCodesSchema,
  generatePartnerCodesSchema,
  isComplimentaryVip,
  partnerInsightsQuerySchema,
  partnerLevelLabel,
  transferRedeemCodesSchema,
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

  it('洞察区间只接受 7～180 天，默认 30', () => {
    expect(partnerInsightsQuerySchema.parse({})).toEqual({ days: 30 });
    expect(partnerInsightsQuerySchema.parse({ days: '90' })).toEqual({ days: 90 });
    expect(() => partnerInsightsQuerySchema.parse({ days: 6 })).toThrow();
    expect(() => partnerInsightsQuerySchema.parse({ days: 181 })).toThrow();
  });

  it('总站生成卡密可以指定给自己或合伙人', () => {
    expect(generateCodesSchema.parse({ planId: 'p1', count: 2 }).ownerUserId).toBeUndefined();
    expect(generateCodesSchema.parse({ planId: 'p1', count: 2, ownerUserId: 'self' }).ownerUserId).toBe('self');
    expect(() => generateCodesSchema.parse({ planId: 'p1', count: 2, ownerUserId: '' })).toThrow();
  });

  it('划转必须带卡密或批次，目标可以是 self', () => {
    expect(transferRedeemCodesSchema.parse({ ownerUserId: 'self', ids: ['abc'] })).toMatchObject({ ownerUserId: 'self' });
    expect(transferRedeemCodesSchema.parse({ ownerUserId: 'self', batchId: 'B123' }).batchId).toBe('B123');
    expect(() => transferRedeemCodesSchema.parse({ ownerUserId: 'self' })).toThrow();
  });
});
