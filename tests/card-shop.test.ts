import { describe, expect, it } from 'vitest';
import {
  CARD_PURCHASE_STATUS_LABELS,
  CARD_SHOP_PAY_TIMEOUT_MS,
  CARD_SHOP_POLL_INTERVAL_MS,
} from '../packages/shared/src/card-shop.ts';
import { cardCheckoutSchema } from '../packages/shared/src/schemas.ts';

describe('卡密下单参数校验', () => {
  it('接受正常入参', () => {
    const parsed = cardCheckoutSchema.parse({ productId: 'p-1', quantity: '2', email: 'buyer@example.com' });
    expect(parsed).toEqual({ productId: 'p-1', quantity: 2, email: 'buyer@example.com' });
  });

  it('拒绝非法邮箱与越界数量', () => {
    expect(() => cardCheckoutSchema.parse({ productId: 'p-1', quantity: 1, email: 'nope' })).toThrow();
    expect(() => cardCheckoutSchema.parse({ productId: 'p-1', quantity: 0, email: 'a@b.com' })).toThrow();
    expect(() => cardCheckoutSchema.parse({ productId: 'p-1', quantity: 99, email: 'a@b.com' })).toThrow();
  });
});

describe('卡密订单状态', () => {
  it('每个状态都有中文文案，避免界面漏出英文枚举', () => {
    expect(Object.values(CARD_PURCHASE_STATUS_LABELS).every((v) => v.length > 0)).toBe(true);
    expect(CARD_PURCHASE_STATUS_LABELS.paid).toBe('已支付');
  });

  it('轮询间隔不快于上游建议的 2 秒', () => {
    expect(CARD_SHOP_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
  });

  it('付款窗口留足真人扫码到银行验证的时间', () => {
    expect(CARD_SHOP_PAY_TIMEOUT_MS).toBeGreaterThanOrEqual(20 * 60_000);
  });
});
