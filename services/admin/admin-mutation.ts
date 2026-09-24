/**
 * The executor for administrative mutations that are not status transitions:
 * forced sign-out, lockout remediation, category management and the AI agent
 * kill switch.
 *
 * Same guarantees as the governed-change executor, in the same order:
 *
 *   1. a malformed id is refused before any read;
 *   2. the capability is decided (RBAC, MFA, super-admin gate) and a refusal is
 *      audited, before the record is read;
 *   3. the justification is checked;
 *   4. `run` executes inside ONE transaction — it locks and loads the record,
 *      applies its resource rules, writes, and audits — so the change and its
 *      audit record commit together or not at all.
 *
 * A refusal thrown by `run` rolls the transaction back and is audited
 * afterwards.
 */

import type { RequestContext } from '../../lib/audit/audit';
import {
  type AdminCapability,
  type Justification,
  authorizeCapability,
  checkJustification,
} from '../../lib/authz/admin-policy';
import { AuthorizationError, type Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction, prisma } from '../../lib/db/client';
import type { TransitionRisk } from '../../domain/lifecycle/machine';
import { denialMessage } from '../lifecycle/authorization';
import {
  type AdminOutcome,
  type AdminOutcomeBase,
  AdminRejection,
  auditAdminDenial,
  inAdminTransaction,
  isConcurrencyConflict,
  isUuid,
  rejectedOutcome,
} from './outcome';

export interface AdminMutation {
  readonly entityType: string;
  /** Null when the mutation creates the record. */
  readonly entityId: string | null;
  /** A name for the action, used in the outcome and the audit trail. */
  readonly event: string;
  readonly actor: Actor;
  readonly capability: AdminCapability;
  readonly risk: TransitionRisk;
  readonly financial?: boolean | undefined;
  readonly justification: Justification;
  readonly context?: RequestContext | undefined;
  /** Runs inside the transaction. Throw an `AdminRejection` to refuse. */
  run(tx: PrismaTransaction, base: AdminOutcomeBase): Promise<AdminOutcome>;
}

export async function executeAdminMutation(mutation: AdminMutation, db: Db = prisma): Promise<AdminOutcome> {
  const base: AdminOutcomeBase = {
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    event: mutation.event,
  };

  if (mutation.entityId !== null && !isUuid(mutation.entityId)) {
    return rejectedOutcome(
      { ...base, entityId: null },
      new AdminRejection('NOT_FOUND', `No ${mutation.entityType.toLowerCase()} with that id.`),
    );
  }

  const denial = {
    actor: mutation.actor,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    event: mutation.event,
    risk: mutation.risk,
    financial: mutation.financial ?? false,
    context: mutation.context,
  };

  const decision = authorizeCapability(mutation.actor, mutation.capability);
  if (!decision.allowed) {
    const rejection = new AdminRejection('FORBIDDEN', denialMessage(decision.reason, undefined), {
      denyReason: decision.reason,
    });
    await auditAdminDenial(db, { ...denial, rejection });
    return rejectedOutcome(base, rejection);
  }

  const failure = checkJustification(mutation.risk, mutation.justification, { requireExpectedStatus: false });
  if (failure) {
    const rejection = new AdminRejection(failure.code, failure.message);
    await auditAdminDenial(db, { ...denial, rejection });
    return rejectedOutcome(base, rejection);
  }

  try {
    return await inAdminTransaction(db, (tx) => mutation.run(tx, base));
  } catch (error) {
    if (error instanceof AdminRejection) {
      await auditAdminDenial(db, { ...denial, rejection: error });
      return rejectedOutcome(base, error);
    }
    if (error instanceof AuthorizationError) {
      // A grant checked inside `run` against the loaded record.
      const rejection = new AdminRejection('FORBIDDEN', denialMessage(error.reason, undefined), {
        denyReason: error.reason,
      });
      await auditAdminDenial(db, { ...denial, rejection });
      return rejectedOutcome(base, rejection);
    }
    if (isConcurrencyConflict(error)) {
      return rejectedOutcome(base, new AdminRejection('CONFLICT', 'A concurrent change to this record won. Reload and retry.'));
    }
    throw error;
  }
}
