/**
 * 卡密兑换的并发安全性验收。
 *
 * 这一组用例必须打真实 PostgreSQL——`SELECT ... FOR UPDATE` 的行为
 * 无法用 mock 复现，而防双花恰恰是最不能出错的地方。
 * 数据库不可用时整个套件自动跳过，不阻塞纯逻辑测试。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

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
  console.warn('[redeem-lock] 数据库不可达，跳过兑换并发测试（先执行 npm run db:up）');
}

suite('卡密兑换行锁防双花', async () => {
  const { db, t, closeDb } = await import('../apps/api/src/core/db.js');
  const { redeemCode, generateCodes } = await import('../apps/api/src/modules/membership/service.js');
  const { AppError } = await import('../apps/api/src/core/errors.js');

  const tag = `vitest-${Date.now()}`;
  let planId: string;
  const userIds: string[] = [];

  /** 造一个只属于本次测试的套餐与若干用户，结束后整批清理。 */
  beforeAll(async () => {
    const [plan] = await db
      .insert(t.plans)
      .values({
        code: `${tag}-monthly`,
        name: `${tag} 月卡`,
        priceCents: 1000,
        durationDays: 30,
        description: '并发测试专用',
        isActive: false,
        sortOrder: 9999,
      })
      .returning({ id: t.plans.id });
    planId = plan!.id;

    for (let i = 0; i < 3; i += 1) {
      const [user] = await db
        .insert(t.users)
        .values({
          username: `${tag}-u${i}`,
          usernameNormalized: `${tag}-u${i}`,
          email: `${tag}-u${i}@vitest.local`,
          emailNormalized: `${tag}-u${i}@vitest.local`,
          displayName: `测试用户 ${i}`,
          passwordHash: 'x',
          role: 'user',
          status: 'active',
        })
        .returning({ id: t.users.id });
      userIds.push(user!.id);
    }
  });

  afterAll(async () => {
    for (const userId of userIds) {
      await db.delete(t.orders).where(eq(t.orders.userId, userId));
      await db.delete(t.subscriptions).where(eq(t.subscriptions.userId, userId));
    }
    if (planId) {
      await db.delete(t.redeemCodes).where(eq(t.redeemCodes.planId, planId));
      await db.delete(t.orders).where(eq(t.orders.planId, planId));
      await db.delete(t.subscriptions).where(eq(t.subscriptions.planId, planId));
    }
    for (const userId of userIds) {
      await db.delete(t.users).where(eq(t.users.id, userId));
    }
    if (planId) await db.delete(t.plans).where(eq(t.plans.id, planId));
    await closeDb();
  });

  const mintCode = async (overrides: { expiresAt?: Date } = {}) => {
    const { codes } = await generateCodes({
      planId,
      count: 1,
      prefix: 'VT',
      expiresAt: overrides.expiresAt ?? null,
      note: tag,
      createdBy: userIds[0]!,
    });
    return codes[0]!;
  };

  it('同一张卡被 8 个并发请求抢兑，只能有 1 个成功', async () => {
    const code = await mintCode();
    const userId = userIds[0]!;

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => redeemCode({ code: code, userId })),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);
    // 失败的必须是「已被使用」，而不是死锁或未知错误
    for (const r of failed) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as InstanceType<typeof AppError>).message).toContain('已被使用');
    }
  });

  it('抢兑之后只落一条订单，会员时长不会被叠加两次', async () => {
    const code = await mintCode();
    const userId = userIds[1]!;

    await Promise.allSettled(Array.from({ length: 6 }, () => redeemCode({ code: code, userId })));

    const orders = await db.select().from(t.orders).where(eq(t.orders.userId, userId));
    const subs = await db.select().from(t.subscriptions).where(eq(t.subscriptions.userId, userId));
    const [user] = await db
      .select({ vipExpiresAt: t.users.vipExpiresAt })
      .from(t.users)
      .where(eq(t.users.id, userId));

    expect(orders).toHaveLength(1);
    expect(subs).toHaveLength(1);

    const daysGranted = (user!.vipExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(daysGranted).toBeGreaterThan(29);
    expect(daysGranted).toBeLessThan(31);
  });

  it('兑换成功后卡密状态变为 used 并记下使用者', async () => {
    const code = await mintCode();
    const userId = userIds[2]!;

    const result = await redeemCode({ code: code, userId });
    expect(result.durationDays).toBe(30);
    expect(result.extended).toBe(false);

    const [row] = await db.select().from(t.redeemCodes).where(eq(t.redeemCodes.code, code));
    expect(row!.status).toBe('used');
    expect(row!.usedByUserId).toBe(userId);
    expect(row!.usedAt).toBeInstanceOf(Date);
  });

  it('已是会员时二次兑换按到期时间顺延，而不是从今天重算', async () => {
    const userId = userIds[2]!;
    const [before] = await db
      .select({ vipExpiresAt: t.users.vipExpiresAt })
      .from(t.users)
      .where(eq(t.users.id, userId));

    const second = await redeemCode({ code: await mintCode(), userId });
    expect(second.extended).toBe(true);

    const [after] = await db
      .select({ vipExpiresAt: t.users.vipExpiresAt })
      .from(t.users)
      .where(eq(t.users.id, userId));

    const delta = (after!.vipExpiresAt!.getTime() - before!.vipExpiresAt!.getTime()) / 86_400_000;
    expect(delta).toBeCloseTo(30, 1);
  });

  it('不存在的卡密报 404 而不是静默放行', async () => {
    await expect(redeemCode({ code: 'DEFINITELY-NOT-A-CODE', userId: userIds[0]! })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('过期卡密兑换失败，并被顺手标记成 expired', async () => {
    const code = String(await mintCode({ expiresAt: new Date(Date.now() - 86_400_000) }));

    await expect(redeemCode({ code, userId: userIds[0]! })).rejects.toMatchObject({ status: 409 });

    const [row] = await db.select().from(t.redeemCodes).where(eq(t.redeemCodes.code, code));
    expect(row!.status).toBe('expired');
  });

  it('停用的卡密无法兑换', async () => {
    const code = await mintCode();
    await db.update(t.redeemCodes).set({ status: 'disabled' }).where(eq(t.redeemCodes.code, code));

    await expect(redeemCode({ code, userId: userIds[0]! })).rejects.toMatchObject({ status: 409 });
  });

  it('兑换失败时事务整体回滚，不会留下孤儿订单', async () => {
    const code = await mintCode();
    const ghostUserId = '00000000-0000-0000-0000-000000000000';

    await expect(redeemCode({ code, userId: ghostUserId })).rejects.toThrow();

    const [row] = await db.select().from(t.redeemCodes).where(eq(t.redeemCodes.code, code));
    // 用户不存在导致回滚，卡密必须还能给正常用户使用
    expect(row!.status).toBe('unused');

    const orphans = await db.select().from(t.orders).where(eq(t.orders.redeemCodeId, row!.id));
    expect(orphans).toHaveLength(0);
  });

  it('批量生成的卡密互不重复', async () => {
    const { batchId, codes } = await generateCodes({
      planId,
      count: 50,
      prefix: 'VTBULK',
      expiresAt: null,
      note: tag,
      createdBy: userIds[0]!,
    });

    expect(batchId).toBeTruthy();
    expect(codes).toHaveLength(50);
    expect(new Set(codes).size).toBe(50);
    expect(codes.every((v) => v.startsWith('VTBULK'))).toBe(true);
  });
});
