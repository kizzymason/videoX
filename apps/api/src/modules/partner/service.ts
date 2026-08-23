import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AdminPartnerRow,
  PartnerCustomer,
  PartnerLevel,
  PartnerOverview,
  PartnerProfile,
  PartnerStatus,
  RedeemCode,
} from '@videox/shared';
import { PARTNER_CODE_PREFIX } from '@videox/shared';
import { db, sqlRows, t } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { applyVipDays, generateCodes, getPartnerPlan, toRedeemCode } from '../membership/service.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PartnerRow {
  userId: string;
  status: PartnerStatus;
  level: PartnerLevel;
  codeQuota: number;
  daysQuota: number;
  codesIssued: number;
  daysIssued: number;
  note: string | null;
  appointedAt: Date;
  revokedAt: Date | null;
}

function remainingOf(row: Pick<PartnerRow, 'codeQuota' | 'daysQuota' | 'codesIssued' | 'daysIssued'>) {
  return {
    codeRemaining: Math.max(0, row.codeQuota - row.codesIssued),
    daysRemaining: Math.max(0, row.daysQuota - row.daysIssued),
  };
}

export function toPartnerProfile(row: PartnerRow): PartnerProfile {
  return {
    userId: row.userId,
    status: row.status,
    level: row.level,
    note: row.note,
    appointedAt: row.appointedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    codeQuota: row.codeQuota,
    daysQuota: row.daysQuota,
    codesIssued: row.codesIssued,
    daysIssued: row.daysIssued,
    ...remainingOf(row),
  };
}

async function lockPartner(tx: Tx, userId: string): Promise<PartnerRow> {
  const rows = await sqlRows<PartnerRow>(
    sql`
      SELECT
        user_id AS "userId",
        status,
        level,
        code_quota AS "codeQuota",
        days_quota AS "daysQuota",
        codes_issued AS "codesIssued",
        days_issued AS "daysIssued",
        note,
        appointed_at AS "appointedAt",
        revoked_at AS "revokedAt"
      FROM partners
      WHERE user_id = ${userId}
      FOR UPDATE
    `,
    tx,
  );
  const row = rows[0];
  if (!row) throw AppError.forbidden('合伙人档案不存在');
  if (row.status !== 'active') throw AppError.forbidden('合伙人权限已取消');
  return {
    ...row,
    appointedAt: new Date(row.appointedAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  };
}

export async function requireActivePartner(userId: string): Promise<PartnerRow> {
  const [row] = await db.select().from(t.partners).where(eq(t.partners.userId, userId)).limit(1);
  if (!row || row.status !== 'active') throw AppError.forbidden('合伙人权限已取消');
  return row;
}

async function loadPartnerRow(userId: string, requireActive = true): Promise<PartnerRow> {
  const [row] = await db.select().from(t.partners).where(eq(t.partners.userId, userId)).limit(1);
  if (!row) throw AppError.notFound('合伙人档案不存在');
  if (requireActive && row.status !== 'active') throw AppError.forbidden('合伙人权限已取消');
  return row;
}

export async function getPartnerProfile(userId: string): Promise<PartnerProfile> {
  const row = await requireActivePartner(userId);
  return toPartnerProfile(row);
}

export async function appointPartner(params: {
  userId: string;
  level: PartnerLevel;
  codeQuota: number;
  daysQuota: number;
  note?: string | null;
}): Promise<PartnerProfile> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: t.users.id, role: t.users.role })
      .from(t.users)
      .where(eq(t.users.id, params.userId))
      .limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    if (user.role === 'admin') {
      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(t.users)
        .where(eq(t.users.role, 'admin'));
      if (Number(countRow?.total ?? 0) <= 1) {
        throw AppError.badRequest('不能把唯一的管理员改成合伙人');
      }
    }

    await tx.update(t.users).set({ role: 'partner', updatedAt: new Date() }).where(eq(t.users.id, params.userId));

    const now = new Date();
    const [existing] = await tx.select().from(t.partners).where(eq(t.partners.userId, params.userId)).limit(1);
    if (existing) {
      const [updated] = await tx
        .update(t.partners)
        .set({
          status: 'active',
          level: params.level,
          codeQuota: params.codeQuota,
          daysQuota: params.daysQuota,
          note: params.note ?? existing.note,
          appointedAt: existing.status === 'revoked' ? now : existing.appointedAt,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(t.partners.userId, params.userId))
        .returning();
      return toPartnerProfile(updated!);
    }

    const [created] = await tx
      .insert(t.partners)
      .values({
        userId: params.userId,
        status: 'active',
        level: params.level,
        codeQuota: params.codeQuota,
        daysQuota: params.daysQuota,
        note: params.note ?? null,
        appointedAt: now,
      })
      .returning();
    return toPartnerProfile(created!);
  });
}

export async function updatePartner(params: {
  userId: string;
  level?: PartnerLevel;
  codeQuota?: number;
  daysQuota?: number;
  note?: string | null;
}): Promise<PartnerProfile> {
  const [existing] = await db.select().from(t.partners).where(eq(t.partners.userId, params.userId)).limit(1);
  if (!existing) throw AppError.notFound('合伙人不存在');

  const [updated] = await db
    .update(t.partners)
    .set({
      ...(params.level ? { level: params.level } : {}),
      ...(params.codeQuota != null ? { codeQuota: params.codeQuota } : {}),
      ...(params.daysQuota != null ? { daysQuota: params.daysQuota } : {}),
      ...(params.note !== undefined ? { note: params.note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(t.partners.userId, params.userId))
    .returning();
  return toPartnerProfile(updated!);
}

export async function revokePartner(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ id: t.users.id, role: t.users.role }).from(t.users).where(eq(t.users.id, userId)).limit(1);
    if (!user) throw AppError.notFound('用户不存在');

    if (user.role === 'partner') {
      await tx.update(t.users).set({ role: 'user', updatedAt: new Date() }).where(eq(t.users.id, userId));
    }

    const [profile] = await tx.select().from(t.partners).where(eq(t.partners.userId, userId)).limit(1);
    if (!profile) throw AppError.notFound('合伙人档案不存在');

    await tx
      .update(t.partners)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(t.partners.userId, userId));
  });
}

/** 用户页改角色时同步档案：设为合伙人则补建，离开合伙人则撤销。 */
export async function syncPartnerRole(userId: string, nextRole: string, previousRole: string): Promise<void> {
  if (nextRole === 'partner') {
    await appointPartner({ userId, level: 'standard', codeQuota: 0, daysQuota: 0 });
    return;
  }
  if (previousRole === 'partner' && nextRole !== 'partner') {
    const [profile] = await db.select().from(t.partners).where(eq(t.partners.userId, userId)).limit(1);
    if (profile?.status === 'active') await revokePartner(userId);
  }
}

export async function generatePartnerCodes(params: {
  partnerUserId: string;
  days: number;
  count: number;
  salePriceCents: number;
  expiresAt?: Date | null;
  note?: string;
}): Promise<{ batchId: string; codes: string[] }> {
  return db.transaction(async (tx) => {
    const partner = await lockPartner(tx, params.partnerUserId);
    const remaining = remainingOf(partner);
    if (params.count > remaining.codeRemaining) {
      throw AppError.badRequest(`剩余可生成张数不足，还可生成 ${remaining.codeRemaining} 张`);
    }
    const daysNeeded = params.count * params.days;
    if (daysNeeded > remaining.daysRemaining) {
      throw AppError.badRequest(`剩余可发放天数不足，还可发放 ${remaining.daysRemaining} 天`);
    }

    const plan = await getPartnerPlan(tx);
    const result = await generateCodes({
      planId: plan.id,
      count: params.count,
      prefix: PARTNER_CODE_PREFIX,
      expiresAt: params.expiresAt ?? null,
      note: params.note,
      createdBy: params.partnerUserId,
      grantDays: params.days,
      salePriceCents: params.salePriceCents,
      executor: tx,
    });

    if (result.codes.length === 0) throw AppError.internal('生成卡密失败，请重试');

    const issuedDays = result.codes.length * params.days;
    await tx
      .update(t.partners)
      .set({
        codesIssued: partner.codesIssued + result.codes.length,
        daysIssued: partner.daysIssued + issuedDays,
        updatedAt: new Date(),
      })
      .where(eq(t.partners.userId, params.partnerUserId));

    return result;
  });
}

export async function refundPartnerCodeQuota(
  codes: Array<{ createdBy: string | null; status: string; grantDays: number | null }>,
  executor: Tx | typeof db = db,
): Promise<void> {
  const byPartner = new Map<string, { codes: number; days: number }>();
  for (const code of codes) {
    if (!code.createdBy) continue;
    const [owner] = await executor.select({ userId: t.partners.userId }).from(t.partners).where(eq(t.partners.userId, code.createdBy)).limit(1);
    if (!owner) continue;
    const current = byPartner.get(code.createdBy) ?? { codes: 0, days: 0 };
    current.codes += 1;
    if (code.status === 'unused') current.days += code.grantDays ?? 0;
    byPartner.set(code.createdBy, current);
  }

  for (const [userId, delta] of byPartner) {
    await executor
      .update(t.partners)
      .set({
        codesIssued: sql`greatest(0, ${t.partners.codesIssued} - ${delta.codes})`,
        daysIssued: sql`greatest(0, ${t.partners.daysIssued} - ${delta.days})`,
        updatedAt: new Date(),
      })
      .where(eq(t.partners.userId, userId));
  }
}

export async function deletePartnerUnusedCodes(params: { partnerUserId: string; ids: string[] }): Promise<number> {
  return db.transaction(async (tx) => {
    await lockPartner(tx, params.partnerUserId);
    const unique = [...new Set(params.ids)];
    const rows = await tx
      .select({
        id: t.redeemCodes.id,
        createdBy: t.redeemCodes.createdBy,
        status: t.redeemCodes.status,
        grantDays: t.redeemCodes.grantDays,
      })
      .from(t.redeemCodes)
      .where(and(inArray(t.redeemCodes.id, unique), eq(t.redeemCodes.createdBy, params.partnerUserId)));

    const unused = rows.filter((row) => row.status === 'unused');
    if (unused.length === 0) return 0;

    await tx.delete(t.redeemCodes).where(
      inArray(
        t.redeemCodes.id,
        unused.map((row) => row.id),
      ),
    );
    await refundPartnerCodeQuota(unused, tx);
    return unused.length;
  });
}

export async function disablePartnerCode(params: { partnerUserId: string; id: string }): Promise<void> {
  await requireActivePartner(params.partnerUserId);
  const [row] = await db
    .update(t.redeemCodes)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(
      and(
        eq(t.redeemCodes.id, params.id),
        eq(t.redeemCodes.createdBy, params.partnerUserId),
        eq(t.redeemCodes.status, 'unused'),
      ),
    )
    .returning({ id: t.redeemCodes.id });
  if (!row) throw AppError.badRequest('只能停用自己未使用的卡密');
}

export async function partnerGrantVip(params: { partnerUserId: string; customerId: string; days: number }): Promise<{ vipExpiresAt: string }> {
  return db.transaction(async (tx) => {
    const partner = await lockPartner(tx, params.partnerUserId);
    const remaining = remainingOf(partner);
    if (params.days > remaining.daysRemaining) {
      throw AppError.badRequest(`剩余可发放天数不足，还可发放 ${remaining.daysRemaining} 天`);
    }

    const [owned] = await tx
      .select({ id: t.redeemCodes.id })
      .from(t.redeemCodes)
      .where(
        and(
          eq(t.redeemCodes.createdBy, params.partnerUserId),
          eq(t.redeemCodes.usedByUserId, params.customerId),
          eq(t.redeemCodes.status, 'used'),
        ),
      )
      .limit(1);
    if (!owned) throw AppError.forbidden('只能给自己的下级客户增加时长');

    const result = await applyVipDays(tx, {
      userId: params.customerId,
      days: params.days,
      note: `合伙人续期 ${params.days} 天`,
    });

    await tx
      .update(t.partners)
      .set({
        daysIssued: partner.daysIssued + params.days,
        updatedAt: new Date(),
      })
      .where(eq(t.partners.userId, params.partnerUserId));

    return result;
  });
}

export async function getPartnerOverview(userId: string): Promise<PartnerOverview> {
  const profile = await getPartnerProfile(userId);
  const [stats] = await db
    .select({
      customerCount: sql<number>`count(distinct ${t.redeemCodes.usedByUserId}) filter (where ${t.redeemCodes.status} = 'used')::int`,
      usedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'used')::int`,
      unusedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'unused')::int`,
      revenueCents: sql<number>`coalesce(sum(${t.redeemCodes.salePriceCents}) filter (where ${t.redeemCodes.status} = 'used'), 0)::int`,
    })
    .from(t.redeemCodes)
    .where(eq(t.redeemCodes.createdBy, userId));

  const [expiring] = await db
    .select({
      expiringSoonCount: sql<number>`count(distinct ${t.users.id})::int`,
    })
    .from(t.redeemCodes)
    .innerJoin(t.users, eq(t.users.id, t.redeemCodes.usedByUserId))
    .where(
      sql`${t.redeemCodes.createdBy} = ${userId}
        AND ${t.redeemCodes.status} = 'used'
        AND ${t.users.vipExpiresAt} IS NOT NULL
        AND ${t.users.vipExpiresAt} > now()
        AND ${t.users.vipExpiresAt} <= now() + interval '7 days'`,
    );

  return {
    ...profile,
    customerCount: Number(stats?.customerCount ?? 0),
    usedCodeCount: Number(stats?.usedCodeCount ?? 0),
    unusedCodeCount: Number(stats?.unusedCodeCount ?? 0),
    revenueCents: Number(stats?.revenueCents ?? 0),
    expiringSoonCount: Number(expiring?.expiringSoonCount ?? 0),
  };
}

export async function listPartnerCustomers(params: {
  partnerUserId: string;
  page: number;
  pageSize: number;
  q?: string;
  expiry?: 'all' | 'active' | 'expiring' | 'expired';
  requireActive?: boolean;
}): Promise<{ items: PartnerCustomer[]; total: number }> {
  if (params.requireActive !== false) await requireActivePartner(params.partnerUserId);
  else await loadPartnerRow(params.partnerUserId, false);

  const filters = [
    sql`${t.redeemCodes.createdBy} = ${params.partnerUserId}`,
    sql`${t.redeemCodes.status} = 'used'`,
    sql`${t.redeemCodes.usedByUserId} IS NOT NULL`,
  ];
  if (params.q) {
    const like = `%${params.q}%`;
    filters.push(sql`(${t.users.username} ILIKE ${like} OR ${t.users.displayName} ILIKE ${like})`);
  }
  if (params.expiry === 'active') {
    filters.push(sql`${t.users.vipExpiresAt} IS NOT NULL AND ${t.users.vipExpiresAt} > now()`);
  } else if (params.expiry === 'expired') {
    filters.push(sql`${t.users.vipExpiresAt} IS NULL OR ${t.users.vipExpiresAt} <= now()`);
  } else if (params.expiry === 'expiring') {
    filters.push(sql`${t.users.vipExpiresAt} > now() AND ${t.users.vipExpiresAt} <= now() + interval '7 days'`);
  }

  const where = sql.join(filters, sql` AND `);

  const [countRows, rows] = await Promise.all([
    sqlRows<{ total: number }>(
      sql`
        SELECT count(*)::int AS total
        FROM (
          SELECT ${t.redeemCodes.usedByUserId} AS user_id
          FROM ${t.redeemCodes}
          INNER JOIN ${t.users} ON ${t.users.id} = ${t.redeemCodes.usedByUserId}
          WHERE ${where}
          GROUP BY ${t.redeemCodes.usedByUserId}
        ) c
      `,
    ),
    sqlRows<{
      userId: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      vipExpiresAt: Date | string | null;
      codeCount: number;
      lastRedeemedAt: Date | string | null;
    }>(
      sql`
        SELECT
          ${t.users.id} AS "userId",
          ${t.users.username} AS username,
          ${t.users.displayName} AS "displayName",
          ${t.users.avatarUrl} AS "avatarUrl",
          ${t.users.vipExpiresAt} AS "vipExpiresAt",
          count(*)::int AS "codeCount",
          max(${t.redeemCodes.usedAt}) AS "lastRedeemedAt"
        FROM ${t.redeemCodes}
        INNER JOIN ${t.users} ON ${t.users.id} = ${t.redeemCodes.usedByUserId}
        WHERE ${where}
        GROUP BY ${t.users.id}
        ORDER BY max(${t.redeemCodes.usedAt}) DESC NULLS LAST
        LIMIT ${params.pageSize}
        OFFSET ${(params.page - 1) * params.pageSize}
      `,
    ),
  ]);

  const now = Date.now();
  const items = rows.map((row) => {
    const expiry = row.vipExpiresAt ? new Date(row.vipExpiresAt) : null;
    const remaining = expiry ? Math.ceil((expiry.getTime() - now) / 86_400_000) : 0;
    return {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      vipExpiresAt: expiry?.toISOString() ?? null,
      isExpired: !expiry || expiry.getTime() <= now,
      daysRemaining: Math.max(0, remaining),
      codeCount: Number(row.codeCount),
      lastRedeemedAt: row.lastRedeemedAt ? new Date(row.lastRedeemedAt).toISOString() : null,
    };
  });

  return { items, total: Number(countRows[0]?.total ?? 0) };
}

export async function listPartnerCodes(params: {
  partnerUserId: string;
  page: number;
  pageSize: number;
  status?: string;
  q?: string;
  requireActive?: boolean;
}): Promise<{ items: RedeemCode[]; total: number }> {
  if (params.requireActive !== false) await requireActivePartner(params.partnerUserId);
  else await loadPartnerRow(params.partnerUserId, false);
  const filters = [eq(t.redeemCodes.createdBy, params.partnerUserId)];
  if (params.status) filters.push(eq(t.redeemCodes.status, params.status as 'unused'));
  if (params.q) filters.push(sql`${t.redeemCodes.code} ILIKE ${`%${params.q.toUpperCase()}%`}`);
  const where = and(...filters);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: t.redeemCodes.id,
        code: t.redeemCodes.code,
        planId: t.redeemCodes.planId,
        batchId: t.redeemCodes.batchId,
        status: t.redeemCodes.status,
        usedByUserId: t.redeemCodes.usedByUserId,
        usedAt: t.redeemCodes.usedAt,
        expiresAt: t.redeemCodes.expiresAt,
        note: t.redeemCodes.note,
        createdBy: t.redeemCodes.createdBy,
        grantDays: t.redeemCodes.grantDays,
        salePriceCents: t.redeemCodes.salePriceCents,
        createdAt: t.redeemCodes.createdAt,
        updatedAt: t.redeemCodes.updatedAt,
        planName: t.plans.name,
        usedByUsername: t.users.username,
      })
      .from(t.redeemCodes)
      .leftJoin(t.plans, eq(t.plans.id, t.redeemCodes.planId))
      .leftJoin(t.users, eq(t.users.id, t.redeemCodes.usedByUserId))
      .where(where)
      .orderBy(desc(t.redeemCodes.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.redeemCodes).where(where),
  ]);

  return {
    items: rows.map((row) => toRedeemCode(row)),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function listAdminPartners(params: {
  page: number;
  pageSize: number;
  q?: string;
  status?: PartnerStatus;
}): Promise<{ items: AdminPartnerRow[]; total: number }> {
  const filters = [];
  if (params.status) filters.push(eq(t.partners.status, params.status));
  if (params.q) {
    const like = `%${params.q}%`;
    filters.push(sql`(${t.users.username} ILIKE ${like} OR ${t.users.displayName} ILIKE ${like} OR ${t.users.email} ILIKE ${like})`);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({
        userId: t.partners.userId,
        status: t.partners.status,
        level: t.partners.level,
        codeQuota: t.partners.codeQuota,
        daysQuota: t.partners.daysQuota,
        codesIssued: t.partners.codesIssued,
        daysIssued: t.partners.daysIssued,
        note: t.partners.note,
        appointedAt: t.partners.appointedAt,
        revokedAt: t.partners.revokedAt,
        username: t.users.username,
        displayName: t.users.displayName,
        avatarUrl: t.users.avatarUrl,
        email: t.users.email,
        role: t.users.role,
      })
      .from(t.partners)
      .innerJoin(t.users, eq(t.users.id, t.partners.userId))
      .where(where)
      .orderBy(desc(t.partners.appointedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.partners)
      .innerJoin(t.users, eq(t.users.id, t.partners.userId))
      .where(where),
  ]);

  const ids = rows.map((row) => row.userId);
  const stats = new Map<
    string,
    { customerCount: number; usedCodeCount: number; unusedCodeCount: number; revenueCents: number }
  >();
  if (ids.length > 0) {
    const statRows = await db
      .select({
        createdBy: t.redeemCodes.createdBy,
        customerCount: sql<number>`count(distinct ${t.redeemCodes.usedByUserId}) filter (where ${t.redeemCodes.status} = 'used')::int`,
        usedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'used')::int`,
        unusedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'unused')::int`,
        revenueCents: sql<number>`coalesce(sum(${t.redeemCodes.salePriceCents}) filter (where ${t.redeemCodes.status} = 'used'), 0)::int`,
      })
      .from(t.redeemCodes)
      .where(inArray(t.redeemCodes.createdBy, ids))
      .groupBy(t.redeemCodes.createdBy);
    for (const row of statRows) {
      if (!row.createdBy) continue;
      stats.set(row.createdBy, {
        customerCount: Number(row.customerCount),
        usedCodeCount: Number(row.usedCodeCount),
        unusedCodeCount: Number(row.unusedCodeCount),
        revenueCents: Number(row.revenueCents),
      });
    }
  }

  const items = rows.map((row) => {
    const extra = stats.get(row.userId) ?? {
      customerCount: 0,
      usedCodeCount: 0,
      unusedCodeCount: 0,
      revenueCents: 0,
    };
    return {
      ...toPartnerProfile(row),
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      email: row.email ?? '',
      role: row.role,
      ...extra,
    };
  });

  return { items, total: Number(countRows[0]?.total ?? 0) };
}

export async function getAdminPartnerDetail(userId: string) {
  const [row] = await db
    .select({
      userId: t.partners.userId,
      status: t.partners.status,
      level: t.partners.level,
      codeQuota: t.partners.codeQuota,
      daysQuota: t.partners.daysQuota,
      codesIssued: t.partners.codesIssued,
      daysIssued: t.partners.daysIssued,
      note: t.partners.note,
      appointedAt: t.partners.appointedAt,
      revokedAt: t.partners.revokedAt,
      username: t.users.username,
      displayName: t.users.displayName,
      avatarUrl: t.users.avatarUrl,
      email: t.users.email,
      role: t.users.role,
    })
    .from(t.partners)
    .innerJoin(t.users, eq(t.users.id, t.partners.userId))
    .where(eq(t.partners.userId, userId))
    .limit(1);
  if (!row) throw AppError.notFound('合伙人不存在');

  const [overview, customers, codes] = await Promise.all([
    getPartnerOverviewForAdmin(userId, row),
    listPartnerCustomers({ partnerUserId: userId, page: 1, pageSize: 20, expiry: 'all', requireActive: false }),
    listPartnerCodes({ partnerUserId: userId, page: 1, pageSize: 20, requireActive: false }),
  ]);

  return {
    partner: overview,
    customers: customers.items,
    customerTotal: customers.total,
    codes: codes.items,
    codeTotal: codes.total,
  };
}

async function getPartnerOverviewForAdmin(userId: string, row: PartnerRow): Promise<AdminPartnerRow> {
  const [user] = await db
    .select({
      username: t.users.username,
      displayName: t.users.displayName,
      avatarUrl: t.users.avatarUrl,
      email: t.users.email,
      role: t.users.role,
    })
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  const [stats] = await db
    .select({
      customerCount: sql<number>`count(distinct ${t.redeemCodes.usedByUserId}) filter (where ${t.redeemCodes.status} = 'used')::int`,
      usedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'used')::int`,
      unusedCodeCount: sql<number>`count(*) filter (where ${t.redeemCodes.status} = 'unused')::int`,
      revenueCents: sql<number>`coalesce(sum(${t.redeemCodes.salePriceCents}) filter (where ${t.redeemCodes.status} = 'used'), 0)::int`,
    })
    .from(t.redeemCodes)
    .where(eq(t.redeemCodes.createdBy, userId));

  return {
    ...toPartnerProfile(row),
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    avatarUrl: user?.avatarUrl ?? null,
    email: user?.email ?? '',
    role: user?.role ?? 'user',
    customerCount: Number(stats?.customerCount ?? 0),
    usedCodeCount: Number(stats?.usedCodeCount ?? 0),
    unusedCodeCount: Number(stats?.unusedCodeCount ?? 0),
    revenueCents: Number(stats?.revenueCents ?? 0),
  };
}
