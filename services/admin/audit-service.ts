/**
 * The audit log reader (Phase 8).
 *
 * Read-only: there is no function anywhere in the admin control plane that
 * updates or deletes an audit record. Access needs `audit:read:any`, and what an
 * actor sees is scoped to their remit (`auditScopeFor`): ADMIN and SUPER_ADMIN
 * read the whole log, FINANCE the financial records, VERIFICATION_MANAGER the
 * verification records.
 *
 * State snapshots were redacted when written (`lib/audit/audit.ts`), so no
 * secret can surface here.
 */

import { type AuditScope, assertCapability, auditScopeFor } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { AUDIT_SEVERITIES } from '../../lib/validation/admin';
import { type Page, type PageRequest, newestFirst, pageSize, toPage } from './pagination';

type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export interface AdminAuditEntry {
  readonly auditId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorType: string;
  readonly actorUserId: string | null;
  readonly actorAiRunId: string | null;
  readonly severity: string;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

export interface AuditLogPage extends Page<AdminAuditEntry> {
  readonly scope: AuditScope;
}

export async function listAuditLogs(
  params: PageRequest & {
    readonly actor: Actor;
    readonly action?: string | undefined;
    readonly entityType?: string | undefined;
    readonly entityId?: string | undefined;
    readonly actorUserId?: string | undefined;
    readonly severity?: AuditSeverity | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
  db: Db = prisma,
): Promise<AuditLogPage> {
  assertCapability(params.actor, 'AUDIT_READ');
  const scope = auditScopeFor(params.actor);
  const size = pageSize(params.limit);

  let entityType: string | { in: string[] } | undefined = params.entityType;
  if (scope.kind === 'ENTITY_TYPES') {
    if (params.entityType !== undefined && !scope.entityTypes.includes(params.entityType)) {
      // Outside the caller's remit: nothing to show, rather than a hint about what exists.
      return { items: [], nextCursor: null, scope };
    }
    entityType = params.entityType ?? { in: [...scope.entityTypes] };
  }

  const rows = await db.auditLog.findMany({
    where: {
      ...(entityType !== undefined ? { entityType } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.entityId ? { entityId: params.entityId } : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(params.to) } : {}),
            },
          }
        : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorType: true,
      actorUserId: true,
      actorAiRunId: true,
      severity: true,
      beforeState: true,
      afterState: true,
      ipAddress: true,
      userAgent: true,
      requestId: true,
      createdAt: true,
    },
  });

  const page = toPage(rows, size, (row) => ({
    auditId: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorAiRunId: row.actorAiRunId,
    severity: row.severity,
    beforeState: row.beforeState,
    afterState: row.afterState,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  }));

  return { ...page, scope };
}
