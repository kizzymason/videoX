import type { Request } from 'express';
import { desc, sql } from 'drizzle-orm';
import type { AuditLogEntry } from '@videox/shared';
import { db, t } from '../../core/db.js';
import { clientIp } from '../../middleware/request-context.js';
import { logger } from '../../core/logger.js';

/** 记录一条管理操作。失败不影响主流程。 */
export async function audit(
  req: Request,
  action: string,
  target?: { type: string; id: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(t.auditLogs).values({
      actorId: req.auth?.id ?? null,
      actorName: null,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      detail: detail ?? null,
      ip: clientIp(req).slice(0, 64),
    });
  } catch (error) {
    logger.debug({ err: error, action }, '审计日志写入失败');
  }
}

export async function listAuditLogs(page: number, pageSize: number) {
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: t.auditLogs.id,
        actorId: t.auditLogs.actorId,
        actorName: t.users.displayName,
        action: t.auditLogs.action,
        targetType: t.auditLogs.targetType,
        targetId: t.auditLogs.targetId,
        detail: t.auditLogs.detail,
        ip: t.auditLogs.ip,
        createdAt: t.auditLogs.createdAt,
      })
      .from(t.auditLogs)
      .leftJoin(t.users, sql`${t.users.id} = ${t.auditLogs.actorId}`)
      .orderBy(desc(t.auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(t.auditLogs),
  ]);

  const items: AuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
  }));

  return { items, total: Number(countRows[0]?.total ?? 0) };
}
