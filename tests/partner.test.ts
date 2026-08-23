/**
 * 合伙人配额、客户绑定与卡密覆盖天数。
 * 需要真实 PostgreSQL；库不可达时跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { PARTNER_PLAN_CODE } from '@videox/shared';

const dbUp = await (async () => {
  try {
    const { db } = await import('../apps/api/src/core/db.js');
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

const suite = dbUp ? describe : describe.skip;
if (!dbUp) {
  console.warn('[partner] 数据库不可达，跳过合伙人集成测试（先执行 npm run db:up）');
}

suite('合伙人卡密与配额', async () => {
  const { db, t, closeDb } = await import('../apps/api/src/core/db.js');
  const { redeemCode, generateCodes } = await import('../apps/api/src/modules/membership/service.js');
  const { toCurrentUser } = await import('../apps/api/src/modules/auth/service.js');
  const {
    appointPartner,
    deletePartnerUnusedCodes,
    generatePartnerCodes,
    getPartnerInsights,
    partnerGrantVip,
    revokePartner,
  } = await import('../apps/api/src/modules/partner/service.js');

  const tag = `partner-${Date.now()}`;
  const userIds: string[] = [];
  let partnerId = '';
  let customerId = '';
  let strangerId = '';
  let adminPlanId = '';

  beforeAll(async () => {
    const [plan] = await db.select({ id: t.plans.id }).from(t.plans).where(eq(t.plans.code, PARTNER_PLAN_CODE)).limit(1);
    if (!plan) {
      await db.insert(t.plans).values({
        code: PARTNER_PLAN_CODE,
        name: '合伙人订阅',
        durationDays: 1,
        priceCents: 0,
        isActive: false,
        sortOrder: 99,
      });
    }

    const [adminPlan] = await db
      .insert(t.plans)
      .values({
        code: `${tag}-monthly`,
        name: `${tag} 月卡`,
        durationDays: 30,
        priceCents: 1000,
        isActive: false,
        sortOrder: 9998,
      })
      .returning({ id: t.plans.id });
    adminPlanId = adminPlan!.id;

    for (const name of ['p', 'c', 's']) {
      const [user] = await db
        .insert(t.users)
        .values({
          username: `${tag}-${name}`,
          usernameNormalized: `${tag}-${name}`,
          email: `${tag}-${name}@vitest.local`,
          emailNormalized: `${tag}-${name}@vitest.local`,
          displayName: `${tag}-${name}`,
          passwordHash: 'x',
          role: 'user',
          status: 'active',
        })
        .returning({ id: t.users.id });
      userIds.push(user!.id);
    }
    partnerId = userIds[0]!;
    customerId = userIds[1]!;
    strangerId = userIds[2]!;

    await appointPartner({ userId: partnerId, level: 'standard', codeQuota: 3, daysQuota: 40 });
  });

  afterAll(async () => {
    await db.delete(t.orders).where(inArray(t.orders.userId, userIds));
    await db.delete(t.subscriptions).where(inArray(t.subscriptions.userId, userIds));
    await db.delete(t.redeemCodes).where(eq(t.redeemCodes.createdBy, partnerId));
    if (adminPlanId) {
      await db.delete(t.redeemCodes).where(eq(t.redeemCodes.planId, adminPlanId));
      await db.delete(t.orders).where(eq(t.orders.planId, adminPlanId));
      await db.delete(t.subscriptions).where(eq(t.subscriptions.planId, adminPlanId));
      await db.delete(t.plans).where(eq(t.plans.id, adminPlanId));
    }
    await db.delete(t.partners).where(eq(t.partners.userId, partnerId));
    for (const id of userIds) await db.delete(t.users).where(eq(t.users.id, id));
    await closeDb();
  });

  it('合伙人无到期时间也视为会员；撤销后不再自带', async () => {
    const [row] = await db.select().from(t.users).where(eq(t.users.id, partnerId)).limit(1);
    expect(row!.role).toBe('partner');
    expect(toCurrentUser(row!).isVip).toBe(true);

    await revokePartner(partnerId);
    const [revoked] = await db.select().from(t.users).where(eq(t.users.id, partnerId)).limit(1);
    expect(revoked!.role).toBe('user');
    expect(toCurrentUser(revoked!).isVip).toBe(false);

    await appointPartner({ userId: partnerId, level: 'standard', codeQuota: 3, daysQuota: 40 });
  });

  it('配额不足时拒绝生成；删除未使用后退回', async () => {
    await expect(
      generatePartnerCodes({ partnerUserId: partnerId, days: 30, count: 2, salePriceCents: 1900 }),
    ).rejects.toMatchObject({ status: 400 });

    const first = await generatePartnerCodes({
      partnerUserId: partnerId,
      days: 10,
      count: 2,
      salePriceCents: 990,
    });
    expect(first.codes).toHaveLength(2);

    const [afterGen] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    expect(afterGen!.codesIssued).toBe(2);
    expect(afterGen!.daysIssued).toBe(20);

    const unused = await db
      .select({ id: t.redeemCodes.id })
      .from(t.redeemCodes)
      .where(eq(t.redeemCodes.createdBy, partnerId));
    const deleted = await deletePartnerUnusedCodes({
      partnerUserId: partnerId,
      ids: unused.map((r) => r.id),
    });
    expect(deleted).toBe(2);

    const [afterDel] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    expect(afterDel!.codesIssued).toBe(0);
    expect(afterDel!.daysIssued).toBe(0);
  });

  it('合伙人卡密按 grant_days 顺延，并绑定客户', async () => {
    const { codes } = await generatePartnerCodes({
      partnerUserId: partnerId,
      days: 7,
      count: 1,
      salePriceCents: 500,
    });
    const result = await redeemCode({ code: codes[0]!, userId: customerId });
    expect(result.durationDays).toBe(7);
    expect(result.planName).toContain('合伙人订阅');

    const [codeRow] = await db.select().from(t.redeemCodes).where(eq(t.redeemCodes.code, codes[0]!));
    expect(codeRow!.usedByUserId).toBe(customerId);
    expect(codeRow!.grantDays).toBe(7);

    const [user] = await db.select({ vipExpiresAt: t.users.vipExpiresAt }).from(t.users).where(eq(t.users.id, customerId));
    const days = (user!.vipExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  it('不能给非客户续期；给客户续期会扣天数', async () => {
    await expect(partnerGrantVip({ partnerUserId: partnerId, customerId: strangerId, days: 3 })).rejects.toMatchObject({
      status: 403,
    });

    const [before] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    await partnerGrantVip({ partnerUserId: partnerId, customerId, days: 3 });
    const [after] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    expect(after!.daysIssued).toBe(before!.daysIssued + 3);

    const used = await db
      .select({ id: t.redeemCodes.id, status: t.redeemCodes.status })
      .from(t.redeemCodes)
      .where(eq(t.redeemCodes.createdBy, partnerId));
    const usedIds = used.filter((r) => r.status === 'used').map((r) => r.id);
    const refunded = await deletePartnerUnusedCodes({ partnerUserId: partnerId, ids: usedIds });
    expect(refunded).toBe(0);
    const [still] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    expect(still!.daysIssued).toBe(after!.daysIssued);
  });

  it('管理员生成卡密不受合伙人配额影响', async () => {
    const [before] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    await generateCodes({
      planId: adminPlanId,
      count: 2,
      prefix: 'AD',
      createdBy: partnerId,
    });
    const [after] = await db.select().from(t.partners).where(eq(t.partners.userId, partnerId));
    expect(after!.codesIssued).toBe(before!.codesIssued);
    expect(after!.daysIssued).toBe(before!.daysIssued);
  });

  it('洞察补齐空日期、K 线与核销客户', async () => {
    const insights = await getPartnerInsights(partnerId, 30);
    expect(insights.days).toBe(30);
    expect(insights.trend).toHaveLength(30);
    expect(insights.candles.length).toBeGreaterThan(0);
    expect(insights.candles.length).toBeLessThanOrEqual(15);
    expect(insights.weekday).toHaveLength(7);
    expect(insights.rangeActivations).toBeGreaterThanOrEqual(1);
    expect(insights.rangeRevenueCents).toBeGreaterThanOrEqual(500);
    expect(insights.topCustomers.some((row) => row.userId === customerId)).toBe(true);
    expect(insights.statusBreakdown.find((row) => row.label === '已使用')?.value).toBeGreaterThanOrEqual(1);
    expect(insights.expiryBuckets.reduce((sum, row) => sum + row.value, 0)).toBeGreaterThanOrEqual(1);
    expect(insights.trend.reduce((sum, point) => sum + point.revenueCents, 0)).toBe(insights.rangeRevenueCents);
  });
});
