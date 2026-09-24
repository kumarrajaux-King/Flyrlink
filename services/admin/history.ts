/**
 * Decision history for admin detail views, read from the audit log.
 *
 * The audit log is the system of record for who decided what and why: it is
 * append-only and written in the same transaction as every change. Reading the
 * history from it, rather than from extra columns, means the history shown to an
 * operator cannot disagree with the audit trail.
 */

import type { Db } from '../../lib/db/client';

export interface HistoryEntry {
  readonly action: string;
  readonly event: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly reason: string | null;
  readonly actorUserId: string | null;
  readonly at: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function auditHistory(
  db: Db,
  entityType: string,
  entityId: string,
  actions: readonly string[],
  limit = 100,
): Promise<HistoryEntry[]> {
  const entries = await db.auditLog.findMany({
    where: { entityType, entityId, action: { in: [...actions] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { action: true, actorUserId: true, beforeState: true, afterState: true, createdAt: true },
  });

  return entries.map((entry) => {
    const before = record(entry.beforeState);
    const after = record(entry.afterState);
    return {
      action: entry.action,
      event: text(after.event),
      from: text(before.status),
      to: text(after.status),
      reason: text(after.reason),
      actorUserId: entry.actorUserId,
      at: entry.createdAt.toISOString(),
    };
  });
}
