/**
 * Audit logging.
 *
 * Master spec §34 requires login and security events, role changes, and every
 * privileged action to be traceable to an actor. `audit_logs` is append-only:
 * this module only ever inserts.
 *
 * Writes take a `Db`, so an audit record can be written inside the same
 * transaction as the change it describes. That is what stops a state change and
 * its audit trail from diverging when something fails midway.
 */

import type { Prisma } from '../../src/generated/prisma/client';
import type { Db } from '../db/client';

/**
 * Audit action names. A closed list rather than free-form strings, so the admin
 * audit view can filter reliably and a typo cannot create a silently orphaned
 * action name.
 */
export const AUDIT_ACTIONS = {
  // Authentication
  USER_REGISTERED: 'user.registered',
  USER_LOGIN_SUCCEEDED: 'user.login.succeeded',
  USER_LOGIN_FAILED: 'user.login.failed',
  USER_LOGIN_BLOCKED: 'user.login.blocked',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_EMAIL_VERIFIED: 'user.email.verified',
  // Credentials
  PASSWORD_RESET_REQUESTED: 'user.password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'user.password.reset_completed',
  PASSWORD_CHANGED: 'user.password.changed',
  // MFA
  MFA_ENROLLMENT_STARTED: 'user.mfa.enrollment_started',
  MFA_ENABLED: 'user.mfa.enabled',
  MFA_DISABLED: 'user.mfa.disabled',
  MFA_CHALLENGE_SUCCEEDED: 'user.mfa.challenge_succeeded',
  MFA_CHALLENGE_FAILED: 'user.mfa.challenge_failed',
  MFA_BACKUP_CODE_USED: 'user.mfa.backup_code_used',
  MFA_BACKUP_CODES_REGENERATED: 'user.mfa.backup_codes_regenerated',
  // Sessions
  SESSION_CREATED: 'session.created',
  SESSION_REVOKED: 'session.revoked',
  SESSIONS_REVOKED_ALL: 'session.revoked_all',
  // AI agentic system
  AI_RUN_STARTED: 'ai.run.started',
  AI_RUN_COMPLETED: 'ai.run.completed',
  AI_ACTION_PROPOSED: 'ai.action.proposed',
  AI_ACTION_APPROVED: 'ai.action.approved',
  AI_ACTION_REJECTED: 'ai.action.rejected',
  AI_ACTION_EXECUTED: 'ai.action.executed',
  AI_TOOL_DENIED: 'ai.tool.denied',
  // Lifecycle state machines (Phase 6)
  PROJECT_TRANSITIONED: 'lifecycle.project.transitioned',
  CONTRACT_TRANSITIONED: 'lifecycle.contract.transitioned',
  MILESTONE_TRANSITIONED: 'lifecycle.milestone.transitioned',
  PAYMENT_TRANSITIONED: 'lifecycle.payment.transitioned',
  LIFECYCLE_TRANSITION_DENIED: 'lifecycle.transition.denied',
  // Authorization
  ROLE_ASSIGNED: 'user.role.assigned',
  ROLE_REVOKED: 'user.role.revoked',
  AUTHORIZATION_DENIED: 'authorization.denied',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditActorType = 'USER' | 'SYSTEM' | 'AI_AGENT';
export type AuditSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null | undefined;
  readonly actorType?: AuditActorType | undefined;
  readonly actorUserId?: string | null | undefined;
  readonly actorAiRunId?: string | null | undefined;
  readonly severity?: AuditSeverity | undefined;
  readonly beforeState?: Record<string, unknown> | undefined;
  readonly afterState?: Record<string, unknown> | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly requestId?: string | null | undefined;
}

/**
 * Fields that must never reach the audit log. Audit records are read by
 * operators and retained indefinitely, so a secret written here is a durable
 * leak. Redaction happens on write, not by convention at call sites.
 */
const REDACTED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'rawtoken',
  'sessiontoken',
  'mfasecret',
  'secret',
  'code',
  'backupcode',
  'codehash',
]);

const REDACTED = '[redacted]';

/** Shallow-redact sensitive keys from a state snapshot. */
export function redact(state: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!state) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return output;
}

/** Append one audit record. Pass a transaction to keep it atomic with the change. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  const beforeState = redact(entry.beforeState);
  const afterState = redact(entry.afterState);

  await db.auditLog.create({
    data: {
      actorType: entry.actorType ?? 'USER',
      actorUserId: entry.actorUserId ?? null,
      actorAiRunId: entry.actorAiRunId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      severity: entry.severity ?? 'INFO',
      // The public API takes `Record<string, unknown>` so call sites can pass a
      // state snapshot without ceremony. Prisma's JSON input type is narrower,
      // and TypeScript cannot prove `unknown` is JSON-serialisable, so the cast
      // is confined to this single boundary rather than pushed onto callers.
      ...(beforeState ? { beforeState: beforeState as Prisma.InputJsonValue } : {}),
      ...(afterState ? { afterState: afterState as Prisma.InputJsonValue } : {}),
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}

/** Request-scoped metadata that every auth call should carry through to the log. */
export interface RequestContext {
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly requestId?: string | null | undefined;
}
