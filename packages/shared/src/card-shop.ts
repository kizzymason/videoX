/**
 * 卡密自助购买。收款与发卡都在上游渠道，本站只做转发与展示：
 * 密钥、上游域名与收银台地址都不出后端，浏览器只跟自己的 /api/card-shop 说话。
 */

export const CARD_PURCHASE_STATUSES = ['pending', 'paid', 'expired', 'failed', 'refunded'] as const;
export type CardPurchaseStatus = (typeof CARD_PURCHASE_STATUSES)[number];

/** 上游建议 2～3 秒一次，取 3 秒留出余量给多标签页。 */
export const CARD_SHOP_POLL_INTERVAL_MS = 3000;
/**
 * 付款窗口。真人扫码、切到支付宝、输密码、银行卡验证一路走下来可能要好几分钟，
 * 窗口开得太短会把还在付款的人判成放弃，所以给到半小时。
 */
export const CARD_SHOP_PAY_TIMEOUT_MS = 30 * 60_000;

export interface CardProduct {
  id: string;
  name: string;
  description: string | null;
  /** 对外售价，单位元，直接来自上游字符串以免浮点误差。 */
  price: string;
  perOrderLimit: number;
  inStock: boolean;
}

export interface CardCheckout {
  orderNo: string;
  status: CardPurchaseStatus;
  amount: string;
  quantity: number;
  productName: string;
  /** 二维码经本站代理，PC 端就地扫码，不暴露上游地址。 */
  qrUrl: string | null;
  /**
   * 收银台地址，也就是二维码里的那条链接。
   * 手机上扫自己屏幕不现实、跳过去又必然看到收银台域名，藏不如直给：
   * 移动端用它一键唤起支付宝，PC 端不使用。
   */
  payUrl: string | null;
  codes: string[];
  createdAt: string;
}

export interface CardPurchaseRecord {
  id: string;
  orderNo: string;
  productName: string;
  quantity: number;
  amount: string;
  status: CardPurchaseStatus;
  codes: string[];
  paidAt: string | null;
  createdAt: string;
}

export const CARD_PURCHASE_STATUS_LABELS: Record<CardPurchaseStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  expired: '已超时',
  failed: '失败',
  refunded: '已退款',
};
