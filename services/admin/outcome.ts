/**
 * Outcomes, rejections, transactions and denial auditing shared by every admin
 * mutation.
 *
 * Admin mutations report their result as a typed outcome rather than throwing —
 * the same contract as the Phase 6 lifecycle services — so a route maps it to a
 * status code and a refusal is never silently swallowed. Read services throw
 * `AuthorizationError` instead, as the Phase 7 observability services do.
 */

import { AUDIT_ACTIONS, type AuditSeverity, type RequestContext, writeAudit } from '../../lib/audit/audit';
import type { AdminDenyReason } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import type { Db, PrismaTransaction } from '../../lib/db/client';
import type { TransitionRisk } from '../../domain/lifecycle/machine';
import type { CascadeResult, LifecycleRejectionCode, TransitionDenyReason } from '../lifecycle';

export type AdminRejectionCode =
  | LifecycleRejectionCode
  | 'REASON_REQUIRED'
  | 'CONFIRMATION_REQUIRED'
  /** A lifecycle event that is not platform authority, sent to an admin intervention endpoint. */
  | 'NOT_AN_INTERVENTION';

export type AdminOutcomeDenyReason = AdminDenyReason | TransitionDenyReason;

export interface AdminOutcomeBase {
  readonly entityType: string;
  readonly entityId: string | null;
  readonly event: string;
}

export interface AdminApplied extends AdminOutcomeBase {
  readonly result: 'APPLIED';
  readonly from: string | null;
  readonly to: string | null;
  readonly cascades: readonly CascadeResult[];
  /** Non-sensitive facts about what was done (counts, identifiers of created records). */
  readonly detail?: Readonly<Record<string, unknown>> | undefined;
}

export interface AdminNoOp extends AdminOutcomeBase {
  readonly result: 'NO_OP';
  readonly status: string | null;
}

export interface AdminRejected extends AdminOutcomeBase {
  readonly result: 'REJECTED';
  readonly code: AdminRejectionCode;
  readonly message: string;
  readonly status: string | null;
  readonly denyReason: AdminOutcomeDenyReason | null;
}

export type AdminOutcome = AdminApplied | AdminNoOp | AdminRejected;

/** A refusal. Thrown inside a transaction so nothing it touched survives. */
export class AdminRejection extends Error {
  readonly code: AdminRejectionCode;
  readonly denyReason: AdminOutcomeDenyReason | null;
  /** The record's status when refused, filled in by the executor when known. */
  status: string | null;

  constructor(
    code: AdminRejectionCode,
    message: string,
    options: { denyReason?: AdminOutcomeDenyReason | null; status?: string | null } = {},
  ) {
    super(message);
    this.name = 'AdminRejection';
    this.code = code;
    this.denyReason = options.denyReason ?? null;
    this.status = options.status ?? null;
  }
}

/** Refuse on a contextual rule. */
export function precondition(message: string): AdminRejection {
  return new AdminRejection('PRECONDITION_FAILED', message);
}

export function rejectedOutcome(base: AdminOutcomeBase, rejection: AdminRejection): AdminRejected {
  return {
    ...base,
    result: 'REJECTED',
    code: rejection.code,
    message: rejection.message,
    status: rejection.status,
    denyReason: rejection.denyReason,
  };
}

// ---------------------------------------------------------------------------
// Transactions and locking
// ---------------------------------------------------------------------------

// Generous, because the development database serves one connection at a time.
const ADMIN_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

export async function inAdminTransaction<R>(db: Db, work: (tx: PrismaTransaction) => Promise<R>): Promise<R> {
  if ('$transaction' in db) {
    return db.$transaction(work, ADMIN_TRANSACTION_OPTIONS);
  }
  // Already inside a caller's transaction: join it.
  return work(db);
}

/** Tables an admin mutation locks. A closed list of literals, never caller input. */
export type AdminTable = 'users' | 'expert_verifications' | 'disputes' | 'reviews' | 'payouts' | 'categories' | 'ai_agents';

/** `SELECT … FOR UPDATE` on one row; false when it does not exist. */
export async function lockRow(tx: PrismaTransaction, table: AdminTable, id: string): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`,
    id,
  );
  return rows.length > 0;
}

export function isConcurrencyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === 'P2034') return true;
  const message = error instanceof Error ? error.message : '';
  return /deadlock detected|could not serialize access/i.test(message);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const SEVERITY: Record<TransitionRisk, AuditSeverity> = {
  LOW: 'INFO',
  MEDIUM: 'NOTICE',
  HIGH: 'WARNING',
  CRITICAL: 'CRITICAL',
};

export function severityFor(risk: TransitionRisk): AuditSeverity {
  return SEVERITY[risk];
}

/**
 * Which refusals are recorded — the Phase 6 volume policy (STEP 06 §9): every
 * security-relevant refusal, and any refusal of a financial or high-risk
 * action. A missing record, an unknown event or a lost race is not.
 */
export function isAuditableRejection(code: AdminRejectionCode, risk: TransitionRisk, financial: boolean): boolean {
  switch (code) {
    case 'FORBIDDEN':
    case 'AI_NOT_PERMITTED':
    case 'ACTOR_NOT_PERMITTED':
    case 'WEBHOOK_REJECTED':
    case 'NOT_AN_INTERVENTION':
      return true;
    case 'NOT_FOUND':
    case 'UNKNOWN_EVENT':
    case 'CONFLICT':
      return false;
    default:
      return financial || risk === 'HIGH' || risk === 'CRITICAL';
  }
}

export interface DenialAudit {
  readonly actor: Actor;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly event: string;
  readonly rejection: AdminRejection;
  readonly risk: TransitionRisk;
  readonly financial: boolean;
  readonly context?: RequestContext | undefined;
}

/** Record a refused admin action, when the volume policy says it is worth recording. */
export async function auditAdminDenial(db: Db, denial: DenialAudit): Promise<void> {
  const { rejection } = denial;
  if (!isAuditableRejection(rejection.code, denial.risk, denial.financial)) return;

  await writeAudit(db, {
    action: AUDIT_ACTIONS.ADMIN_ACTION_DENIED,
    entityType: denial.entityType,
    entityId: denial.entityId !== null && isUuid(denial.entityId) ? denial.entityId : null,
    actorUserId: denial.actor.userId,
    severity: denial.risk === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
    afterState: {
      event: denial.event,
      // Not "code": the audit writer redacts that key as a secret.
      rejectionCode: rejection.code,
      ...(rejection.denyReason ? { denyReason: rejection.denyReason } : {}),
      ...(rejection.status ? { status: rejection.status } : {}),
      risk: denial.risk,
      message: rejection.message,
    },
    ...denial.context,
  });
}
