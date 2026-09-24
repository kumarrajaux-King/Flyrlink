/**
 * The governed-change executor, for records the Phase 6 engine does not own:
 * account standing, expert verification, dispute triage, review moderation and
 * payout decisions.
 *
 * It keeps the Phase 6 engine's order of operations, so an administrative change
 * carries the same guarantees as a lifecycle transition:
 *
 *   1. a malformed id or an unknown event is refused before any read;
 *   2. RBAC — through the Phase 6 transition authorizer, so MFA and the
 *      super-admin gate apply — is decided before the record is read, and a
 *      refusal is audited, so an unauthorised caller learns nothing about it;
 *   3. the justification: a reason, and a confirmation of the expected state for
 *      HIGH and CRITICAL events;
 *   4. then, in ONE transaction: lock the row, evaluate the pure machine, apply
 *      the resource rules (self-action, conflict of interest, privileged target),
 *      answer a genuine repeat as NO_OP, refuse a stale view, run the contextual
 *      rules, compare-and-set the status, apply related-record effects, and
 *      write the audit record.
 *
 * A refusal thrown inside the transaction rolls it all back, and is audited
 * afterwards under the Phase 6 volume policy.
 *
 * The Phase 6 engine is not widened to these entities: its entity and table
 * types are closed, and opening them would change the approved lifecycle
 * implementation. The generic evaluator and the transition authorizer are
 * reused unchanged instead.
 */

import { type AuditAction, type RequestContext, writeAudit } from '../../lib/audit/audit';
import {
  type AdminDenyReason,
  adminDenialMessage,
  checkJustification,
  normalizeReason,
} from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction, prisma } from '../../lib/db/client';
import { type StateMachine, type TransitionRisk, evaluateTransition, findTransition } from '../../domain/lifecycle/machine';
import { type Participants, authorizeForTransition, denialMessage } from '../lifecycle/authorization';
import {
  type AdminOutcome,
  type AdminOutcomeBase,
  type AdminTable,
  AdminRejection,
  auditAdminDenial,
  inAdminTransaction,
  isConcurrencyConflict,
  isUuid,
  lockRow,
  rejectedOutcome,
  severityFor,
} from './outcome';

export type GovernedEntityType = 'User' | 'ExpertVerification' | 'Dispute' | 'Review' | 'Payout';

/** Event-specific inputs. Each spec reads only the ones its events use. */
export interface GovernedParams {
  /** Verification APPROVE: the reviewer has read the Verification Agent's flags. */
  readonly acknowledgeAiFlags?: boolean | undefined;
}

export interface GovernedRequest {
  readonly entityId: string;
  readonly event: string;
  /** Always the session's human. There is no AI, SYSTEM or WEBHOOK path into these machines. */
  readonly actor: Actor;
  readonly reason?: string | undefined;
  readonly confirm?: boolean | undefined;
  readonly expectedStatus?: string | undefined;
  readonly params?: GovernedParams | undefined;
  readonly context?: RequestContext | undefined;
}

export interface GovernedScope<S extends string, E extends string, T> {
  readonly tx: PrismaTransaction;
  readonly entity: T;
  readonly event: E;
  readonly from: S;
  readonly to: S;
  readonly risk: TransitionRisk;
  readonly request: GovernedRequest;
  /** The trimmed justification; null only for a LOW-risk event sent without one. */
  readonly reason: string | null;
  readonly now: Date;
}

export interface GovernedSpec<S extends string, E extends string, C, T, D> {
  readonly entityType: GovernedEntityType;
  readonly table: AdminTable;
  readonly machine: StateMachine<S, E, C>;
  readonly auditAction: AuditAction;
  load(tx: PrismaTransaction, id: string): Promise<T | null>;
  status(entity: T): S;
  context(entity: T): C;
  /** Resource rules beyond RBAC. Return a denial, or null to allow. */
  guard(tx: PrismaTransaction, entity: T, event: E, actor: Actor): Promise<AdminDenyReason | null>;
  /**
   * Whether a NO_OP the machine reports is a genuine repeat. Some targets are
   * shared by different situations — a verification is PENDING both before its
   * first review and after more information was requested — and only one of
   * them is a repeat of the event.
   */
  isRepeat?(entity: T, event: E): boolean;
  /** Contextual rules. Throw an `AdminRejection` to refuse. */
  prepare(scope: GovernedScope<S, E, T>): Promise<D>;
  /** The compare-and-set status write. Must return the number of rows changed. */
  write(scope: GovernedScope<S, E, T>, data: D): Promise<number>;
  /** Related-record changes. Returns facts for the audit record. */
  effects(scope: GovernedScope<S, E, T>, data: D): Promise<Record<string, unknown>>;
}

/** Admin machine permissions are all platform authority, so no participants are needed. */
const NO_PARTICIPANTS: Participants = { customerUserId: null, expertUserIds: [] };

function noun(spec: { readonly entityType: string }): string {
  return spec.entityType === 'User' ? 'account' : spec.entityType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Run one governed change. Never throws for a refusal; throws only for genuine failures. */
export async function executeGovernedChange<S extends string, E extends string, C, T, D>(
  spec: GovernedSpec<S, E, C, T, D>,
  request: GovernedRequest,
  db: Db = prisma,
): Promise<AdminOutcome> {
  const base: AdminOutcomeBase = { entityType: spec.entityType, entityId: request.entityId, event: request.event };

  if (!isUuid(request.entityId)) {
    return rejectedOutcome({ ...base, entityId: null }, new AdminRejection('NOT_FOUND', `No ${noun(spec)} with that id.`));
  }

  const definition = findTransition(spec.machine, request.event);
  if (!definition) {
    return rejectedOutcome(
      base,
      new AdminRejection('UNKNOWN_EVENT', `${spec.machine.name} has no event "${request.event}".`),
    );
  }

  const denial = {
    actor: request.actor,
    entityType: spec.entityType,
    entityId: request.entityId,
    event: request.event,
    risk: definition.risk,
    financial: definition.financial,
    context: request.context,
  };

  const decision = authorizeForTransition(request.actor, definition, NO_PARTICIPANTS);
  if (!decision.allowed) {
    const rejection = new AdminRejection('FORBIDDEN', denialMessage(decision.reason, undefined), {
      denyReason: decision.reason,
    });
    await auditAdminDenial(db, { ...denial, rejection });
    return rejectedOutcome(base, rejection);
  }

  const failure = checkJustification(definition.risk, request);
  if (failure) {
    const rejection = new AdminRejection(failure.code, failure.message);
    await auditAdminDenial(db, { ...denial, rejection });
    return rejectedOutcome(base, rejection);
  }

  try {
    return await inAdminTransaction(db, (tx) => apply(spec, request, base, tx));
  } catch (error) {
    if (error instanceof AdminRejection) {
      // The transaction has rolled back; the refusal is recorded on its own.
      await auditAdminDenial(db, { ...denial, rejection: error });
      return rejectedOutcome(base, error);
    }
    if (isConcurrencyConflict(error)) {
      return rejectedOutcome(base, new AdminRejection('CONFLICT', 'A concurrent change to this record won. Reload and retry.'));
    }
    throw error;
  }
}

async function apply<S extends string, E extends string, C, T, D>(
  spec: GovernedSpec<S, E, C, T, D>,
  request: GovernedRequest,
  base: AdminOutcomeBase,
  tx: PrismaTransaction,
): Promise<AdminOutcome> {
  const locked = await lockRow(tx, spec.table, request.entityId);
  const entity = locked ? await spec.load(tx, request.entityId) : null;
  if (entity === null) {
    throw new AdminRejection('NOT_FOUND', `No ${noun(spec)} with that id.`);
  }

  const current = spec.status(entity);
  // The event was validated against this machine before the transaction began.
  const event = request.event as E;
  const evaluation = evaluateTransition(spec.machine, current, event, 'HUMAN', spec.context(entity));

  if (
    evaluation.kind === 'REJECTED' &&
    (evaluation.code === 'AI_NOT_PERMITTED' || evaluation.code === 'ACTOR_NOT_PERMITTED')
  ) {
    throw new AdminRejection(evaluation.code, evaluation.message, { status: current });
  }

  // Resource rules come before NO_OP, so a repeat cannot be used to probe a
  // record the caller may not act on.
  const resourceDenial = await spec.guard(tx, entity, event, request.actor);
  if (resourceDenial) {
    throw new AdminRejection('FORBIDDEN', adminDenialMessage(resourceDenial), {
      denyReason: resourceDenial,
      status: current,
    });
  }

  if (evaluation.kind === 'NO_OP') {
    if (spec.isRepeat && !spec.isRepeat(entity, event)) {
      throw new AdminRejection(
        'INVALID_TRANSITION',
        `${spec.machine.name}.${event} cannot fire from ${current} in this case.`,
        { status: current },
      );
    }
    return { ...base, result: 'NO_OP', status: current };
  }

  if (request.expectedStatus !== undefined && request.expectedStatus !== current) {
    throw new AdminRejection(
      'CONFLICT',
      `Expected this ${noun(spec)} to be ${request.expectedStatus}, but it is ${current}.`,
      { status: current },
    );
  }

  if (evaluation.kind === 'REJECTED') {
    throw new AdminRejection(evaluation.code, evaluation.message, { status: current });
  }

  const scope: GovernedScope<S, E, T> = {
    tx,
    entity,
    event,
    from: evaluation.from,
    to: evaluation.to,
    risk: evaluation.definition.risk,
    request,
    reason: normalizeReason(request.reason),
    now: new Date(),
  };

  let data: D;
  try {
    data = await spec.prepare(scope);
  } catch (error) {
    if (error instanceof AdminRejection && error.status === null) error.status = current;
    throw error;
  }

  const written = await spec.write(scope, data);
  if (written !== 1) {
    throw new AdminRejection('CONFLICT', `This ${noun(spec)} changed while the action was being applied.`, {
      status: current,
    });
  }

  const facts = await spec.effects(scope, data);

  await writeAudit(tx, {
    action: spec.auditAction,
    entityType: spec.entityType,
    entityId: request.entityId,
    actorUserId: request.actor.userId,
    severity: severityFor(scope.risk),
    beforeState: { status: scope.from },
    afterState: {
      status: scope.to,
      event,
      ...(scope.reason ? { reason: scope.reason } : {}),
      ...facts,
    },
    ...request.context,
  });

  return { ...base, result: 'APPLIED', from: scope.from, to: scope.to, cascades: [] };
}
