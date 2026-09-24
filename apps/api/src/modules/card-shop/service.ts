import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  CARD_SHOP_PAY_TIMEOUT_MS,
  type CardCheckout,
  type CardProduct,
  type CardPurchaseRecord,
  type CardPurchaseStatus,
} from '@videox/shared';
import { db, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { cached } from '../../core/redis.js';
import { decryptSecret, encryptSecret } from '../../core/secret-box.js';
import {
  createUpstreamCheckout,
  fetchProducts,
  fetchUpstreamOrder,
  type UpstreamProduct,
} from './upstream.js';

type PurchaseRow = typeof t.cardPurchases.$inferSelect;

/** 我方订单号，同时作为上游的幂等键：重复提交只会拿回首单。 */
function nextReference(): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `CS${stamp}${randomBytes(3).toString('hex').toUpperCase()}`;
}

function toCents(amount: string | number | null | undefined): number {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** 上游状态词表没有强约束，只认「已付」，其余保守当待付。 */
function mapStatus(raw: string | null | undefined): CardPurchaseStatus {
  const value = (raw ?? '').toLowerCase();
  if (value === 'paid' || value === 'success' || value === 'completed') return 'paid';
  if (value === 'refunded' || value === 'reversed') return 'refunded';
  if (value === 'expired' || value === 'closed' || value === 'canceled') return 'expired';
  if (value === 'failed') return 'failed';
  return 'pending';
}

function readCodes(row: PurchaseRow): string[] {
  if (!row.codesEncrypted) return [];
  try {
    const parsed = JSON.parse(decryptSecret(row.codesEncrypted)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch (error) {
    // 密钥换过或密文损坏时不能连订单一起打不开，记一条告警后按无卡密处理。
    logger.error({ err: error, purchaseId: row.id }, '卡密解密失败');
    return [];
  }
}

function qrUrlFor(row: PurchaseRow): string | null {
  const source = (row.payload as { qrSource?: string } | null)?.qrSource;
  if (!source || !row.upstreamOrderNo) return null;
  return `/api/card-shop/checkouts/${encodeURIComponent(row.upstreamOrderNo)}/qr`;
}

function toCheckout(row: PurchaseRow): CardCheckout {
  return {
    orderNo: row.upstreamOrderNo ?? row.reference,
    status: row.status,
    amount: (row.amountCents / 100).toFixed(2),
    quantity: row.quantity,
    productName: row.productName,
    qrUrl: qrUrlFor(row),
    payUrl: (row.payload as { payUrl?: string } | null)?.payUrl ?? null,
    codes: readCodes(row),
    createdAt: row.createdAt.toISOString(),
  };
}

function toRecord(row: PurchaseRow): CardPurchaseRecord {
  return {
    id: row.id,
    orderNo: row.upstreamOrderNo ?? row.reference,
    productName: row.productName,
    quantity: row.quantity,
    amount: (row.amountCents / 100).toFixed(2),
    status: row.status,
    codes: readCodes(row),
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 商品列表短缓存。上游的佣金字段绝不能进这个返回值。 */
export async function listProducts(): Promise<CardProduct[]> {
  return cached('card-shop:products', 60, async () => {
    const items = await fetchProducts();
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? null,
      price: Number(item.price ?? 0).toFixed(2),
      perOrderLimit: Math.max(1, Number(item.perOrderLimit ?? 1)),
      inStock: Number(item.stock ?? 0) > 0,
    }));
  });
}

async function findProduct(productId: string): Promise<UpstreamProduct> {
  const items = await fetchProducts();
  const product = items.find((item) => item.id === productId);
  if (!product) throw AppError.badRequest('该规格已下架，请刷新后重试');
  if (Number(product.stock ?? 0) <= 0) throw AppError.badRequest('该规格暂时售罄，请稍后再试');
  return product;
}

export async function createCheckout(params: {
  userId: string;
  productId: string;
  quantity: number;
  email: string;
}): Promise<CardCheckout> {
  const product = await findProduct(params.productId);
  const limit = Math.max(1, Number(product.perOrderLimit ?? 1));
  if (params.quantity > limit) throw AppError.badRequest(`该规格单次最多购买 ${limit} 张`);

  const reference = nextReference();
  const amountCents = toCents(product.price) * params.quantity;

  // 先落本地单再调上游：万一上游超时但实际下单成功，reference 仍能查回同一笔。
  const [row] = await db
    .insert(t.cardPurchases)
    .values({
      userId: params.userId,
      reference,
      productId: product.id,
      productName: product.name,
      quantity: params.quantity,
      amountCents,
      email: params.email,
      status: 'pending',
    })
    .returning();
  if (!row) throw AppError.internal('下单失败，请重试');

  const checkout = await createUpstreamCheckout({
    productId: product.id,
    quantity: params.quantity,
    email: params.email,
    reference,
  });

  const qrSource = checkout.img || checkout.qrcode || '';
  // qrcode 与 payUrl 是同一条收银台地址，img 只是它的二维码图片。
  const payUrl = checkout.payUrl || checkout.qrcode || null;
  const [updated] = await db
    .update(t.cardPurchases)
    .set({
      upstreamOrderNo: checkout.orderNo,
      amountCents: toCents(checkout.amount) || amountCents,
      payload: { qrSource, payUrl },
      updatedAt: new Date(),
    })
    .where(eq(t.cardPurchases.id, row.id))
    .returning();

  return toCheckout(updated ?? row);
}

async function loadOwnedPurchase(userId: string, orderNo: string): Promise<PurchaseRow> {
  const [row] = await db
    .select()
    .from(t.cardPurchases)
    .where(and(eq(t.cardPurchases.upstreamOrderNo, orderNo), eq(t.cardPurchases.userId, userId)))
    .limit(1);
  if (!row) throw AppError.notFound('订单不存在');
  return row;
}

/** 落地已支付状态与卡密。轮询与回调都走这里，重复调用是幂等的。 */
async function persistPaid(row: PurchaseRow, codes: string[], amount?: string): Promise<PurchaseRow> {
  const [updated] = await db
    .update(t.cardPurchases)
    .set({
      status: 'paid',
      codesEncrypted: codes.length > 0 ? encryptSecret(JSON.stringify(codes)) : row.codesEncrypted,
      amountCents: amount ? toCents(amount) || row.amountCents : row.amountCents,
      paidAt: row.paidAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(t.cardPurchases.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * 轮询订单状态。
 *
 * 这条路径要足够皮实：买家正盯着二维码等出卡，任何一次上游抖动都不该让页面报错、
 * 更不该让轮询断掉。因此上游查询失败只记日志并原样返回本地状态，前端继续轮询。
 * 「超时」也只在上游确认未支付之后才敢盖，避免把已付款的人误判成放弃。
 */
export async function syncCheckout(params: { userId: string; orderNo: string }): Promise<CardCheckout> {
  const row = await loadOwnedPurchase(params.userId, params.orderNo);

  // 已经拿到卡密就不再打扰上游，省额度也省一次网络往返。
  if (row.status === 'paid' && row.codesEncrypted) return toCheckout(row);

  let upstream: Awaited<ReturnType<typeof fetchUpstreamOrder>>;
  try {
    upstream = await fetchUpstreamOrder(params.orderNo);
  } catch (error) {
    logger.warn({ err: error, orderNo: params.orderNo }, '查询上游订单失败，本轮沿用本地状态');
    return toCheckout(row);
  }

  const status = mapStatus(upstream.status);

  if (status === 'paid') {
    const codes = (upstream.codes ?? []).filter((c): c is string => typeof c === 'string');
    return toCheckout(await persistPaid(row, codes, upstream.amount));
  }

  const timedOut = status === 'pending' && Date.now() - row.createdAt.getTime() > CARD_SHOP_PAY_TIMEOUT_MS;
  const next = timedOut ? 'expired' : status;

  if (next !== row.status) {
    const [updated] = await db
      .update(t.cardPurchases)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(t.cardPurchases.id, row.id))
      .returning();
    return toCheckout(updated ?? row);
  }

  return toCheckout(row);
}

export async function getQrSource(params: { userId: string; orderNo: string }): Promise<string> {
  const row = await loadOwnedPurchase(params.userId, params.orderNo);
  const source = (row.payload as { qrSource?: string } | null)?.qrSource;
  if (!source) throw AppError.notFound('该订单没有二维码');
  return source;
}

export async function listMyPurchases(userId: string): Promise<CardPurchaseRecord[]> {
  const rows = await db
    .select()
    .from(t.cardPurchases)
    .where(eq(t.cardPurchases.userId, userId))
    .orderBy(desc(t.cardPurchases.createdAt))
    .limit(50);
  return rows.map(toRecord);
}

/**
 * 成交回调。只用来提前把状态与卡密写下来，
 * 权威来源仍是买家侧轮询走的 syncCheckout。
 */
export async function applyWebhook(event: {
  event: string;
  data: { orderNo?: string; reference?: string; amount?: string };
}): Promise<void> {
  const { orderNo, reference } = event.data ?? {};
  const [row] = await db
    .select()
    .from(t.cardPurchases)
    .where(reference ? eq(t.cardPurchases.reference, reference) : eq(t.cardPurchases.upstreamOrderNo, orderNo ?? ''))
    .limit(1);
  if (!row) return;

  if (event.event === 'order.reversed') {
    await db
      .update(t.cardPurchases)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(eq(t.cardPurchases.id, row.id));
    return;
  }

  if (event.event !== 'order.paid') return;
  const lookupNo = row.upstreamOrderNo ?? orderNo;
  if (!lookupNo) return;

  // 回调不带卡密，仍要回查一次才能拿到 codes。
  const upstream = await fetchUpstreamOrder(lookupNo);
  if (mapStatus(upstream.status) !== 'paid') return;
  const codes = (upstream.codes ?? []).filter((c): c is string => typeof c === 'string');
  await persistPaid(row, codes, upstream.amount ?? event.data.amount);
}
