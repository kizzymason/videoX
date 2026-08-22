import { eq, sql } from 'drizzle-orm';
import type { MembershipPlan, Order, RedeemCode, RedeemResult, Subscription } from '@videox/shared';
import { compactRedeemCode, normalizeRedeemInput } from '@videox/shared';
import { db, t, sqlRows } from '../../core/db.js';
import { AppError, ErrorCode } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { generateCode, randomSegment } from './codes.js';

export { generateCode } from './codes.js';

export function toPlan(row: typeof t.plans.$inferSelect): MembershipPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    durationDays: row.durationDays,
    priceCents: row.priceCents,
    originalPriceCents: row.originalPriceCents,
    perks: row.perks ?? [],
    badge: row.badge,
    isRecommended: row.isRecommended,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export async function listPlans(activeOnly = true): Promise<MembershipPlan[]> {
  const rows = await db
    .select()
    .from(t.plans)
    .where(activeOnly ? eq(t.plans.isActive, true) : sql`true`)
    .orderBy(t.plans.sortOrder, t.plans.priceCents);
  return rows.map(toPlan);
}

function nextOrderNo(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `VX${stamp}${randomSegment(6)}`;
}

/**
 * 卡密兑换。整个流程在一个事务里完成，靠 `SELECT ... FOR UPDATE` 行锁串行化：
 *
 *   1. 锁住这一行兑换码（并发请求会在此阻塞，而不是各自读到 unused）
 *   2. 在锁内复核状态与有效期
 *   3. 标记已用 → 顺延订阅 → 更新用户 vip_expires_at → 写订单
 *
 * 任何一步失败都整体回滚，因此不存在「码被标记已用但会员没到账」的中间态，
 * 也不存在两个并发请求同时兑换成功的双花。
 *
 * 「过期」是唯一需要在回滚之后仍然落库的状态变更，因此单独放在事务外补写。
 */
export async function redeemCode(params: { code: string; userId: string }): Promise<RedeemResult> {
  const expired: { codeId?: string } = {};

  try {
    return await runRedeem(params, expired);
  } finally {
    if (expired.codeId) {
      // 补写失败不能盖掉原本要抛给调用方的「已过期」错误
      await db
        .update(t.redeemCodes)
        .set({ status: 'expired' })
        .where(eq(t.redeemCodes.id, expired.codeId))
        .catch((error) => logger.warn({ err: error, codeId: expired.codeId }, '标记兑换码过期失败'));
    }
  }
}

function runRedeem(params: { code: string; userId: string }, expired: { codeId?: string }): Promise<RedeemResult> {
  return db.transaction(async (tx) => {
    const typed = normalizeRedeemInput(params.code);
    const compact = compactRedeemCode(params.code);
    // 走原生 SQL 才能拿到 FOR UPDATE，代价是绕过了 drizzle 的列映射：
    // node-postgres 在 drizzle 下把 timestamptz 解析成字符串，这里必须自己转。
    // 新码是 12 位无连字符；旧码带 -，两种写法都能对上。
    const locked = await sqlRows<{
      id: string;
      plan_id: string;
      status: string;
      expires_at: string | Date | null;
    }>(
      sql`
        SELECT id, plan_id, status, expires_at
        FROM redeem_codes
        WHERE code = ${typed} OR replace(code, '-', '') = ${compact}
        FOR UPDATE
      `,
      tx,
    );

    const code = locked[0];
    if (!code) {
      throw new AppError({ message: '兑换码不存在，请检查是否输入正确', code: ErrorCode.CODE_NOT_FOUND, status: 404 });
    }
    if (code.status === 'used') {
      throw new AppError({ message: '该兑换码已被使用', code: ErrorCode.CODE_ALREADY_USED, status: 409 });
    }
    if (code.status === 'disabled') {
      throw new AppError({ message: '该兑换码已被停用', code: ErrorCode.CODE_DISABLED, status: 409 });
    }
    const codeExpiresAt = code.expires_at ? new Date(code.expires_at) : null;
    if (codeExpiresAt && codeExpiresAt.getTime() < Date.now()) {
      expired.codeId = code.id;
      throw new AppError({ message: '该兑换码已过期', code: ErrorCode.CODE_EXPIRED, status: 409 });
    }

    const [plan] = await tx.select().from(t.plans).where(eq(t.plans.id, code.plan_id)).limit(1);
    if (!plan) throw AppError.notFound('兑换码关联的套餐不存在');

    const [user] = await tx
      .select({ id: t.users.id, vipExpiresAt: t.users.vipExpiresAt })
      .from(t.users)
      .where(eq(t.users.id, params.userId))
      .limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    // 已是会员则从现有到期时间往后顺延，不是从今天重新算。
    const now = new Date();
    const currentExpiry = user.vipExpiresAt && user.vipExpiresAt.getTime() > now.getTime() ? user.vipExpiresAt : now;
    const extended = currentExpiry.getTime() > now.getTime();
    const newExpiry = new Date(currentExpiry.getTime() + plan.durationDays * 86_400_000);

    await tx
      .update(t.redeemCodes)
      .set({ status: 'used', usedByUserId: params.userId, usedAt: now, updatedAt: now })
      .where(eq(t.redeemCodes.id, code.id));

    await tx.update(t.users).set({ vipExpiresAt: newExpiry, updatedAt: now }).where(eq(t.users.id, params.userId));

    await tx
      .insert(t.subscriptions)
      .values({
        userId: params.userId,
        planId: plan.id,
        status: 'active',
        startsAt: extended ? currentExpiry : now,
        expiresAt: newExpiry,
      })
      .returning({ id: t.subscriptions.id });

    await tx.insert(t.orders).values({
      orderNo: nextOrderNo(),
      userId: params.userId,
      planId: plan.id,
      amountCents: plan.priceCents,
      source: 'redeem_code',
      status: 'paid',
      redeemCodeId: code.id,
      note: `卡密兑换：${plan.name}`,
    });

    logger.info({ userId: params.userId, planId: plan.id }, '兑换码使用成功');

    return {
      planName: plan.name,
      durationDays: plan.durationDays,
      vipExpiresAt: newExpiry.toISOString(),
      extended,
    };
  });
}

/** 管理员手动赠送会员，同样走顺延逻辑并留下订单流水。 */
export async function grantVip(params: {
  userId: string;
  days: number;
  operatorId: string;
  note?: string;
}): Promise<{ vipExpiresAt: string }> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: t.users.id, vipExpiresAt: t.users.vipExpiresAt })
      .from(t.users)
      .where(eq(t.users.id, params.userId))
      .limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    const now = new Date();
    const base = user.vipExpiresAt && user.vipExpiresAt.getTime() > now.getTime() ? user.vipExpiresAt : now;
    const newExpiry = new Date(base.getTime() + params.days * 86_400_000);

    await tx.update(t.users).set({ vipExpiresAt: newExpiry, updatedAt: now }).where(eq(t.users.id, params.userId));

    await tx.insert(t.subscriptions).values({
      userId: params.userId,
      planId: null,
      status: 'active',
      startsAt: now,
      expiresAt: newExpiry,
    });

    await tx.insert(t.orders).values({
      orderNo: nextOrderNo(),
      userId: params.userId,
      planId: null,
      amountCents: 0,
      source: 'manual_grant',
      status: 'paid',
      note: params.note ?? `管理员赠送 ${params.days} 天`,
    });

    return { vipExpiresAt: newExpiry.toISOString() };
  });
}

export async function revokeVip(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(t.users).set({ vipExpiresAt: null, updatedAt: new Date() }).where(eq(t.users.id, userId));
    await tx.update(t.subscriptions).set({ status: 'canceled' }).where(eq(t.subscriptions.userId, userId));
  });
}

export interface GenerateCodesResult {
  batchId: string;
  codes: string[];
}

/**
 * 批量生成卡密。唯一索引冲突时用 onConflictDoNothing 跳过，
 * 循环补足到目标数量，避免极小概率的碰撞导致整批失败。
 */
export async function generateCodes(params: {
  planId: string;
  count: number;
  prefix?: string;
  expiresAt?: Date | null;
  note?: string;
  createdBy: string;
}): Promise<GenerateCodesResult> {
  const [plan] = await db.select().from(t.plans).where(eq(t.plans.id, params.planId)).limit(1);
  if (!plan) throw AppError.notFound('套餐不存在');

  const batchId = `B${Date.now().toString(36).toUpperCase()}${randomSegment(4)}`;
  const created: string[] = [];

  for (let attempt = 0; attempt < 5 && created.length < params.count; attempt += 1) {
    const remaining = params.count - created.length;
    const batch = Array.from({ length: remaining }, () => generateCode(params.prefix));

    const inserted = await db
      .insert(t.redeemCodes)
      .values(
        batch.map((code) => ({
          code,
          planId: params.planId,
          batchId,
          status: 'unused' as const,
          expiresAt: params.expiresAt ?? null,
          note: params.note ?? null,
          createdBy: params.createdBy,
        })),
      )
      .onConflictDoNothing({ target: t.redeemCodes.code })
      .returning({ code: t.redeemCodes.code });

    created.push(...inserted.map((r) => r.code));
  }

  return { batchId, codes: created };
}

export function toRedeemCode(
  row: typeof t.redeemCodes.$inferSelect & { planName?: string | null; usedByUsername?: string | null },
): RedeemCode {
  return {
    id: row.id,
    code: row.code,
    planId: row.planId,
    planName: row.planName ?? '',
    batchId: row.batchId,
    status: row.status,
    usedByUserId: row.usedByUserId,
    usedByUsername: row.usedByUsername ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOrder(
  row: typeof t.orders.$inferSelect & { username?: string | null; planName?: string | null },
): Order {
  return {
    id: row.id,
    orderNo: row.orderNo,
    userId: row.userId,
    username: row.username ?? '',
    planId: row.planId,
    planName: row.planName ?? null,
    amountCents: row.amountCents,
    source: row.source,
    status: row.status,
    redeemCodeId: row.redeemCodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getMySubscriptions(userId: string): Promise<Subscription[]> {
  const rows = await db
    .select({
      id: t.subscriptions.id,
      userId: t.subscriptions.userId,
      planId: t.subscriptions.planId,
      planName: t.plans.name,
      status: t.subscriptions.status,
      startsAt: t.subscriptions.startsAt,
      expiresAt: t.subscriptions.expiresAt,
      createdAt: t.subscriptions.createdAt,
    })
    .from(t.subscriptions)
    .leftJoin(t.plans, eq(t.plans.id, t.subscriptions.planId))
    .where(eq(t.subscriptions.userId, userId))
    .orderBy(sql`${t.subscriptions.createdAt} desc`)
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    planId: r.planId,
    planName: r.planName,
    status: r.status,
    startsAt: r.startsAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 把已到期的订阅标记为 expired，定时任务调用。 */
export async function expireSubscriptions(): Promise<number> {
  const updated = await sqlRows<{ id: string }>(sql`
    UPDATE subscriptions SET status = 'expired'
    WHERE status = 'active' AND expires_at < now()
    RETURNING id
  `);
  return updated.length;
}

/** 导出为 CSV，供后台下载。 */
export function codesToCsv(codes: RedeemCode[]): string {
  const header = '兑换码,套餐,状态,批次,使用者,使用时间,过期时间,备注,创建时间';
  const escape = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const statusLabels: Record<string, string> = {
    unused: '未使用',
    used: '已使用',
    disabled: '已停用',
    expired: '已过期',
  };
  const lines = codes.map((c) =>
    [
      escape(c.code),
      escape(c.planName),
      escape(statusLabels[c.status] ?? c.status),
      escape(c.batchId),
      escape(c.usedByUsername),
      escape(c.usedAt),
      escape(c.expiresAt),
      escape(c.note),
      escape(c.createdAt),
    ].join(','),
  );
  // 加 BOM，Excel 打开中文不乱码。
  return `\uFEFF${header}\n${lines.join('\n')}`;
}
