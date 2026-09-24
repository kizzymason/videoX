import { describe, expect, it } from 'vitest';
import {
  extendVipExpiry,
  isVipRenewal,
  MS_PER_DAY,
  ORDER_SOURCES,
  SIGNUP_GIFT_MAX_DAYS,
  siteSettingsSchema,
} from '@videox/shared';

const base = { siteName: 'PandaGV' };

describe('新用户注册赠送会员天数', () => {
  it('默认不赠送', () => {
    expect(siteSettingsSchema.parse(base).signupGiftDays).toBe(0);
  });

  it('旧配置里没有这个字段也能解析，不会被新增字段卡住校验', () => {
    const legacy = { siteName: 'PandaGV', defaultTheme: 'dark', allowRegistration: false };
    const parsed = siteSettingsSchema.parse(legacy);
    expect(parsed.signupGiftDays).toBe(0);
    expect(parsed.defaultTheme).toBe('dark');
    expect(parsed.allowRegistration).toBe(false);
  });

  it('后台保存后如实生效', () => {
    expect(siteSettingsSchema.parse({ ...base, signupGiftDays: 7 }).signupGiftDays).toBe(7);
  });

  it('数字输入框传上来的是字符串也能收下', () => {
    expect(siteSettingsSchema.parse({ ...base, signupGiftDays: '30' }).signupGiftDays).toBe(30);
  });

  it('0 是合法的关闭值', () => {
    expect(siteSettingsSchema.parse({ ...base, signupGiftDays: 0 }).signupGiftDays).toBe(0);
  });

  it('负数被拒绝', () => {
    expect(() => siteSettingsSchema.parse({ ...base, signupGiftDays: -1 })).toThrow();
  });

  it('小数被拒绝，会员天数必须是整天', () => {
    expect(() => siteSettingsSchema.parse({ ...base, signupGiftDays: 1.5 })).toThrow();
  });

  it('超过上限被拒绝，上限值本身可用', () => {
    expect(() => siteSettingsSchema.parse({ ...base, signupGiftDays: SIGNUP_GIFT_MAX_DAYS + 1 })).toThrow();
    expect(siteSettingsSchema.parse({ ...base, signupGiftDays: SIGNUP_GIFT_MAX_DAYS }).signupGiftDays).toBe(
      SIGNUP_GIFT_MAX_DAYS,
    );
  });

  it('订单来源里有 signup_gift，后台流水能区分赠送与人工发放', () => {
    expect(ORDER_SOURCES).toContain('signup_gift');
  });
});

describe('会员到期时间计算', () => {
  const now = new Date('2026-09-25T00:00:00.000Z');

  it('从未开通的用户从当下起算', () => {
    expect(extendVipExpiry(null, 7, now).toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('已是会员时从原到期时间顺延，不吃掉剩余天数', () => {
    const current = new Date('2026-10-10T00:00:00.000Z');
    expect(extendVipExpiry(current, 7, now).toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });

  it('已经过期的会员从当下重新起算', () => {
    const current = new Date('2026-09-01T00:00:00.000Z');
    expect(extendVipExpiry(current, 7, now).toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('恰好在这一刻到期算已过期，不计入续期', () => {
    expect(isVipRenewal(new Date(now), now)).toBe(false);
    expect(extendVipExpiry(new Date(now), 7, now).toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('赠送 365 天正好是 365 个自然日', () => {
    expect(extendVipExpiry(null, 365, now).getTime() - now.getTime()).toBe(365 * MS_PER_DAY);
  });

  it('赠送天数达到上限时到期时间仍在合理范围内', () => {
    const expiry = extendVipExpiry(null, SIGNUP_GIFT_MAX_DAYS, now);
    expect(expiry.getTime() - now.getTime()).toBe(SIGNUP_GIFT_MAX_DAYS * MS_PER_DAY);
    expect(expiry.getUTCFullYear()).toBe(2036);
  });
});
