import { randomInt } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { DeviceSignals, SiteSettings } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { deviceFingerprint, ipFingerprint, signalFingerprint } from '../auth/device-fingerprint.js';
import { applyVipDays } from '../membership/service.js';

/**
 * 邀请码用 8 位、去掉易混字符（0/O/1/I）的大写字母数字。
 * 用户会手抄、念给朋友，字符集越干净越好。
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * 懒生成：一个用户一条，第一次需要时写库。
 * 并发下可能两个请求同时生成，用唯一索引 + 冲突忽略，最后都读回同一行。
 */
export async function ensureInviteCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ code: t.inviteCodes.code })
    .from(t.inviteCodes)
    .where(eq(t.inviteCodes.userId, userId))
    .limit(1);
  if (existing) return existing.code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await db.insert(t.inviteCodes).values({ userId, code: generateInviteCode() }).onConflictDoNothing();
    } catch (error) {
      logger.warn({ err: error, userId }, '邀请码写入失败，重试');
    }
    const [row] = await db
      .select({ code: t.inviteCodes.code })
      .from(t.inviteCodes)
      .where(eq(t.inviteCodes.userId, userId))
      .limit(1);
    if (row) return row.code;
  }
  throw new Error('邀请码生成失败，请稍后重试');
}

export interface InviteSummary {
  invited: number;
  daysEarned: number;
  lastInvitedAt: string | null;
}

export async function getInviteSummary(userId: string): Promise<InviteSummary> {
  const [row] = await db
    .select({
      invited: sql<number>`count(*) filter (where ${t.invitations.status} = 'granted')::int`,
      daysEarned: sql<number>`coalesce(sum(${t.invitations.days}) filter (where ${t.invitations.status} = 'granted'), 0)::int`,
      lastInvitedAt: sql<Date | null>`max(${t.invitations.createdAt}) filter (where ${t.invitations.status} = 'granted')`,
    })
    .from(t.invitations)
    .where(eq(t.invitations.inviterId, userId));

  return {
    invited: Number(row?.invited ?? 0),
    daysEarned: Number(row?.daysEarned ?? 0),
    lastInvitedAt: row?.lastInvitedAt ? new Date(row.lastInvitedAt).toISOString() : null,
  };
}

export type InviteRewardStatus = 'granted' | 'rejected' | 'ignored';

export interface InviteRewardResult {
  status: InviteRewardStatus;
  days: number;
  reason?: string;
}

/**
 * 注册时结算邀请奖励。
 *
 * 防刷不是"拦注册"，而是"不发奖励"：注册成功与否不受影响，命中规则的记录
 * 以 status='rejected' 落库，后台能看见谁在试。
 *
 * 规则（全部按"一台设备/一个 IP 只能拿一次"出发）：
 * - 自己的邀请码不能给自己
 * - 同一台设备已经拿过邀请奖励 → device_reused
 * - 同一个 IP 已经拿过邀请奖励 → ip_reused
 * - 邀请人自己的注册设备/IP 与被邀请人相同 → same_device / same_ip
 */
export async function applyInviteReward(params: {
  inviteeId: string;
  inviteeUsername: string;
  code: string;
  ip: string;
  userAgent: string;
  signals: DeviceSignals;
  seed: string | null;
  settings: SiteSettings;
}): Promise<InviteRewardResult> {
  const code = params.code.trim().toUpperCase();
  if (!code) return { status: 'ignored', days: 0, reason: 'empty_code' };

  const [inviter] = await db
    .select({ id: t.users.id, username: t.users.username, lastLoginIp: t.users.lastLoginIp })
    .from(t.inviteCodes)
    .innerJoin(t.users, eq(t.users.id, t.inviteCodes.userId))
    .where(eq(t.inviteCodes.code, code))
    .limit(1);

  // 码不存在就当没填，不打扰注册。
  if (!inviter) return { status: 'ignored', days: 0, reason: 'code_not_found' };
  if (inviter.id === params.inviteeId) return { status: 'ignored', days: 0, reason: 'self' };

  const days = params.settings.inviteRewardDays;
  const inviteeIp = params.ip ? ipFingerprint(params.ip) : '';
  const deviceHash = params.seed
    ? deviceFingerprint(params.seed, params.userAgent, params.signals)
    : signalFingerprint(params.userAgent, params.signals);

  const record = async (status: 'granted' | 'rejected', reason: string, grantedDays: number) => {
    await db
      .insert(t.invitations)
      .values({
        inviterId: inviter.id,
        inviteeId: params.inviteeId,
        code,
        status,
        reason,
        days: grantedDays,
        inviteeIp,
        inviterIp: inviter.lastLoginIp ? ipFingerprint(inviter.lastLoginIp) : '',
        deviceHash,
        userAgent: params.userAgent.slice(0, 300),
      })
      .onConflictDoNothing();
  };

  const reject = async (reason: string): Promise<InviteRewardResult> => {
    await record('rejected', reason, 0);
    logger.warn({ inviterId: inviter.id, inviteeId: params.inviteeId, reason }, '邀请奖励被防刷规则拒绝');
    return { status: 'rejected', days: 0, reason };
  };

  if (!params.settings.inviteEnabled || days <= 0) return reject('disabled');

  const [deviceHit] = await db
    .select({ id: t.invitations.id })
    .from(t.invitations)
    .where(and(eq(t.invitations.deviceHash, deviceHash), eq(t.invitations.status, 'granted')))
    .limit(1);
  if (deviceHit) return reject('device_reused');

  if (inviteeIp) {
    const [ipHit] = await db
      .select({ id: t.invitations.id })
      .from(t.invitations)
      .where(and(eq(t.invitations.inviteeIp, inviteeIp), eq(t.invitations.status, 'granted')))
      .limit(1);
    if (ipHit) return reject('ip_reused');
  }

  const inviterGuards = await db
    .select({ kind: t.registerGuards.kind, fingerprint: t.registerGuards.fingerprint })
    .from(t.registerGuards)
    .where(eq(t.registerGuards.userId, inviter.id));

  if (inviterGuards.some((g) => (g.kind === 'device' || g.kind === 'signal') && g.fingerprint === deviceHash)) {
    return reject('same_device');
  }
  if (inviteeIp) {
    const inviterIp = inviter.lastLoginIp ? ipFingerprint(inviter.lastLoginIp) : '';
    if (inviterIp === inviteeIp || inviterGuards.some((g) => g.kind === 'ip' && g.fingerprint === inviteeIp)) {
      return reject('same_ip');
    }
  }

  try {
    await db.transaction(async (tx) => {
      await applyVipDays(tx, {
        userId: inviter.id,
        days,
        note: `邀请好友 ${params.inviteeUsername} 注册，奖励 ${days} 天`,
        source: 'invite_reward',
      });
      await applyVipDays(tx, {
        userId: params.inviteeId,
        days,
        note: `受邀注册奖励 ${days} 天`,
        source: 'invite_reward',
      });
      await tx.insert(t.invitations).values({
        inviterId: inviter.id,
        inviteeId: params.inviteeId,
        code,
        status: 'granted',
        reason: '',
        days,
        inviteeIp,
        inviterIp: inviter.lastLoginIp ? ipFingerprint(inviter.lastLoginIp) : '',
        deviceHash,
        userAgent: params.userAgent.slice(0, 300),
      });
    });
  } catch (error) {
    logger.error({ err: error, inviterId: inviter.id, inviteeId: params.inviteeId }, '邀请奖励发放失败');
    return { status: 'ignored', days: 0, reason: 'grant_failed' };
  }

  logger.info({ inviterId: inviter.id, inviteeId: params.inviteeId, days }, '邀请奖励已发放');
  return { status: 'granted', days };
}

// ---------------------------------------------------------------------------
// 后台
// ---------------------------------------------------------------------------

export async function listInvitations(params: {
  page: number;
  pageSize: number;
  q?: string;
  status?: 'granted' | 'rejected';
}) {
  const like = params.q ? `%${params.q}%` : '';
  const qFilter = params.q
    ? sql`and (inviter.username ilike ${like} or inviter.display_name ilike ${like} or invitee.username ilike ${like} or invitee.display_name ilike ${like})`
    : sql``;
  const statusFilter = params.status ? sql`and i.status = ${params.status}` : sql``;
  const from = sql`
    from invitations i
    join users inviter on inviter.id = i.inviter_id
    join users invitee on invitee.id = i.invitee_id
    where 1 = 1 ${qFilter} ${statusFilter}
  `;

  const [rows, counted] = await Promise.all([
    db.execute(sql`
      select i.id, i.status, i.reason, i.days, i.code, i.invitee_ip, i.inviter_ip, i.device_hash, i.created_at,
             inviter.id as inviter_id, inviter.username as inviter_username, inviter.display_name as inviter_name,
             invitee.id as invitee_id, invitee.username as invitee_username, invitee.display_name as invitee_name
      ${from}
      order by i.created_at desc
      limit ${params.pageSize} offset ${(params.page - 1) * params.pageSize}
    `),
    db.execute(sql`select count(*)::int as total ${from}`),
  ]);

  return {
    rows: rows.rows as Array<Record<string, unknown>>,
    total: Number((counted.rows[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

export async function getInviteOverview() {
  const [totals] = await db
    .select({
      totalInvited: sql<number>`count(*) filter (where ${t.invitations.status} = 'granted')::int`,
      totalDays: sql<number>`coalesce(sum(${t.invitations.days}) filter (where ${t.invitations.status} = 'granted'), 0)::int`,
      rejected: sql<number>`count(*) filter (where ${t.invitations.status} = 'rejected')::int`,
      inviters: sql<number>`count(distinct ${t.invitations.inviterId}) filter (where ${t.invitations.status} = 'granted')::int`,
    })
    .from(t.invitations);

  const [today] = await db
    .select({ invited: sql<number>`count(*)::int` })
    .from(t.invitations)
    .where(and(eq(t.invitations.status, 'granted'), gte(t.invitations.createdAt, sql`date_trunc('day', now())`)));

  const top = await db
    .select({
      userId: t.invitations.inviterId,
      username: t.users.username,
      displayName: t.users.displayName,
      invited: sql<number>`count(*)::int`,
      days: sql<number>`coalesce(sum(${t.invitations.days}), 0)::int`,
    })
    .from(t.invitations)
    .innerJoin(t.users, eq(t.users.id, t.invitations.inviterId))
    .where(eq(t.invitations.status, 'granted'))
    .groupBy(t.invitations.inviterId, t.users.username, t.users.displayName)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return {
    totalInvited: Number(totals?.totalInvited ?? 0),
    totalDays: Number(totals?.totalDays ?? 0),
    rejected: Number(totals?.rejected ?? 0),
    inviters: Number(totals?.inviters ?? 0),
    todayInvited: Number(today?.invited ?? 0),
    top,
  };
}
