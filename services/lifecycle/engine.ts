/**
 * The lifecycle transition engine.
 *
 * Every state change to a Project, Contract, Milestone or Payment goes through
 * `executeTransition`. For one proposed event it:
 *
 *   1. locks the entity row (`SELECT … FOR UPDATE`), so concurrent transitions
 *      on the same row serialise instead of racing;
 *   2. asks the pure state machine whether the event is structurally valid for
 *      the current state and the kind of caller (`domain/lifecycle/machine.ts`);
 *   3. authorizes a human caller — or the human an AI agent acts for — against
 *      the event's RBAC alternatives, ownership and party;
 *   4. reports an already-completed transition as NO_OP (idempotency), but only
 *      after authorization, so the answer cannot be used to probe state;
 *   5. refuses a caller acting on a stale view, via an optional `expectedStatus`;
 *   6. runs the entity's contextual rules: business policy, payment state,
 *      dispute rules and webhook verification;
 *   7. writes the status with a compare-and-set on the source state;
 *   8. updates related records and fires follow-on (cascade) transitions;
 *   9. writes an audit record.
 *
 * Steps 1-9 share one database transaction, so a transition, its side effects,
 * its cascades and its audit trail commit together or not at all. A refusal is
 * audited separately, after the transaction has rolled back.
 *
 * There is no other write path to these four status columns in application
 * code. AI agents reach this engine only through the tool layer, as an
 * `AI_AGENT` actor; SYSTEM and WEBHOOK actors are constructed only by server
 * code and are never reachable from the HTTP API.
 */

import {
  type AuditAction,
  type AuditActorType,
  type AuditSeverity,
  AUDIT_ACTIONS,
  type RequestContext,
  writeAudit,
} from '../../lib/audit/audit';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction, prisma } from '../../lib/db/client';
import {
  type RejectionCode,
  type StateMachine,
  type TransitionRisk,
  evaluateTransition,
  findTransition,
} from '../../domain/lifecycle/machine';
import {
  type Participants,
  type TransitionDenyReason,
  authorizeForTransition,
  denialMessage,
} from './authorization';

export type { Participants, TransitionDenyReason } from './authorization';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Who is asking for the transition. */
export type LifecycleActor =
  | { readonly kind: 'HUMAN'; readonly actor: Actor }
  | { readonly kind: 'SYSTEM'; readonly reason: string }
  | { readonly kind: 'WEBHOOK'; readonly webhookEventId: string }
  | { readonly kind: 'AI_AGENT'; readonly aiRunId: string; readonly onBehalfOf: Actor };

export type LifecycleEntityType = 'Project' | 'Contract' | 'Milestone' | 'Payment';

export type LifecycleTable = 'projects' | 'contracts' | 'milestones' | 'payments';

export type LifecycleRejectionCode =
  | RejectionCode
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'WEBHOOK_REJECTED';

export type DisputeResolution = 'RESOLVED_CUSTOMER' | 'RESOLVED_EXPERT' | 'RESOLVED_SPLIT' | 'WITHDRAWN';

export type RiskLevelInput = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Event-specific inputs. Each service reads only the ones its events use. */
export interface TransitionParams {
  readonly reason?: string | undefined;
  readonly description?: string | undefined;
  readonly notes?: string | undefined;
  readonly riskLevel?: RiskLevelInput | undefined;
  readonly assignmentId?: string | undefined;
  readonly resolution?: DisputeResolution | undefined;
  /** Webhook-only: the provider-reported cumulative refunded amount. */
  readonly refundedAmountMinor?: bigint | undefined;
  /** Webhook-only: the provider's failure code and message. */
  readonly failureCode?: string | undefined;
  readonly failureMessage?: string | undefined;
}

export interface TransitionRequest {
  readonly entityId: string;
  readonly event: string;
  readonly actor: LifecycleActor;
  /** Optimistic-concurrency token: the status the caller believes is current. */
  readonly expectedStatus?: string | undefined;
  readonly params?: TransitionParams | undefined;
  readonly context?: RequestContext | undefined;
}

export interface CascadeResult {
  readonly entityType: LifecycleEntityType;
  readonly entityId: string;
  readonly event: string;
  /** APPLIED; NO_OP when already past the event; SKIPPED when it does not apply yet. */
  readonly result: 'APPLIED' | 'NO_OP' | 'SKIPPED';
  readonly from?: string;
  readonly to?: string;
  readonly reason?: string;
}

interface OutcomeBase {
  readonly entityType: LifecycleEntityType;
  readonly entityId: string;
  readonly event: string;
}

export type TransitionOutcome =
  | (OutcomeBase & {
      readonly result: 'APPLIED';
      readonly from: string;
      readonly to: string;
      readonly cascades: readonly CascadeResult[];
    })
  | (OutcomeBase & { readonly result: 'NO_OP'; readonly status: string })
  | (OutcomeBase & {
      readonly result: 'REJECTED';
      readonly code: LifecycleRejectionCode;
      readonly message: string;
      readonly status: string | null;
      readonly denyReason: TransitionDenyReason | null;
    });

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

interface RejectionMeta {
  readonly risk: TransitionRisk;
  readonly financial: boolean;
}

/**
 * A refused transition. Thrown inside the transaction so that nothing it
 * touched survives, and turned into a `REJECTED` outcome at the boundary.
 */
export class LifecycleRejection extends Error {
  readonly code: LifecycleRejectionCode;
  readonly status: string | null;
  readonly denyReason: TransitionDenyReason | null;
  readonly meta: RejectionMeta | null;
  /**
   * True when the refusal happened after the status write. A cascade may only
   * be skipped when it was refused *before* writing anything.
   */
  afterWrite = false;

  constructor(
    code: LifecycleRejectionCode,
    message: string,
    options: {
      status?: string | null;
      denyReason?: TransitionDenyReason | null;
      meta?: RejectionMeta | null;
    } = {},
  ) {
    super(message);
    this.name = 'LifecycleRejection';
    this.code = code;
    this.status = options.status ?? null;
    this.denyReason = options.denyReason ?? null;
    this.meta = options.meta ?? null;
  }
}

/** Convenience for services: refuse on a contextual rule. */
export function precondition(message: string): LifecycleRejection {
  return new LifecycleRejection('PRECONDITION_FAILED', message);
}

// ---------------------------------------------------------------------------
// Service specification
// ---------------------------------------------------------------------------

export interface TransitionScope<S extends string, E extends string, T> {
  readonly tx: PrismaTransaction;
  readonly entity: T;
  readonly event: E;
  readonly from: S;
  readonly to: S;
  readonly definition: RejectionMeta;
  readonly request: TransitionRequest;
  readonly params: TransitionParams;
  readonly now: Date;
  /** The entity this transition is being written for. */
  readonly origin: CascadeOrigin;
}

export interface CascadeOrigin {
  readonly entityType: LifecycleEntityType;
  readonly entityId: string;
  readonly event: string;
}

/**
 * What a lifecycle service supplies. The engine owns the order of operations;
 * the service owns what its entity means.
 */
export interface LifecycleSpec<S extends string, E extends string, C, T, D> {
  readonly entityType: LifecycleEntityType;
  readonly table: LifecycleTable;
  readonly machine: StateMachine<S, E, C>;
  readonly auditAction: AuditAction;
  load(tx: PrismaTransaction, id: string): Promise<T | null>;
  status(entity: T): S;
  participants(tx: PrismaTransaction, entity: T, event: E): Promise<Participants>;
  context(tx: PrismaTransaction, entity: T, event: E): Promise<C>;
  /**
   * Contextual rules — business policy, payment state, dispute rules, webhook
   * verification. Throw a `LifecycleRejection` to refuse. Returns whatever the
   * later phases need, so nothing is looked up twice.
   */
  prepare(scope: TransitionScope<S, E, T>): Promise<D>;
  /** The compare-and-set status write. Must return the number of rows changed. */
  write(scope: TransitionScope<S, E, T>, data: D): Promise<number>;
  /** Related-record changes. Returns facts to include in the audit record. */
  effects(scope: TransitionScope<S, E, T>, data: D): Promise<Record<string, unknown>>;
  /** Follow-on transitions, each fired as SYSTEM when it applies. */
  cascades(scope: TransitionScope<S, E, T>, data: D): Promise<readonly CascadeResult[]>;
  /**
   * Recognise a repeat the state machine cannot see: a redelivered event whose
   * target state a follow-on transition has already moved past. Answered as a
   * NO_OP, like any other repeat.
   */
  isRepeat?(entity: T, request: TransitionRequest): boolean;
}

// Specs are registered by name so cascades can cross services without
// circular imports. `services/lifecycle/index.ts` registers all four.
type AnySpec = LifecycleSpec<string, string, never, unknown, unknown>;
const specs = new Map<LifecycleEntityType, AnySpec>();

export function registerLifecycleSpec<S extends string, E extends string, C, T, D>(
  spec: LifecycleSpec<S, E, C, T, D>,
): void {
  specs.set(spec.entityType, spec as unknown as AnySpec);
}

function specFor(entityType: LifecycleEntityType): AnySpec {
  const spec = specs.get(entityType);
  if (!spec) {
    throw new Error(
      `No lifecycle service is registered for ${entityType}. Import from "services/lifecycle".`,
    );
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

/** The human accountable for a transition, when there is one. */
export function accountableUserId(actor: LifecycleActor): string | null {
  if (actor.kind === 'HUMAN') return actor.actor.userId;
  if (actor.kind === 'AI_AGENT') return actor.onBehalfOf.userId;
  return null;
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

function actorFields(actor: LifecycleActor): {
  actorType: AuditActorType;
  actorUserId: string | null;
  actorAiRunId: string | null;
} {
  switch (actor.kind) {
    case 'HUMAN':
      return { actorType: 'USER', actorUserId: actor.actor.userId, actorAiRunId: null };
    case 'AI_AGENT':
      // Both are recorded: the run that acted, and the human it acted for.
      return { actorType: 'AI_AGENT', actorUserId: actor.onBehalfOf.userId, actorAiRunId: actor.aiRunId };
    default:
      return { actorType: 'SYSTEM', actorUserId: null, actorAiRunId: null };
  }
}

function actorDetail(actor: LifecycleActor): Record<string, unknown> {
  switch (actor.kind) {
    case 'SYSTEM':
      return { systemReason: actor.reason };
    case 'WEBHOOK':
      return { webhookEventId: actor.webhookEventId };
    case 'AI_AGENT':
      return { onBehalfOfUserId: actor.onBehalfOf.userId };
    default:
      return {};
  }
}

const SECURITY_REJECTIONS = new Set<LifecycleRejectionCode>([
  'AI_NOT_PERMITTED',
  'ACTOR_NOT_PERMITTED',
  'FORBIDDEN',
  'WEBHOOK_REJECTED',
]);

/**
 * Which refusals are worth an audit record: every security-relevant one, and
 * any refusal of a financial or high-risk event. Routine user errors (a
 * button pressed twice, a stale page) are not, or the log becomes noise.
 */
function isAuditableRejection(rejection: LifecycleRejection): boolean {
  if (SECURITY_REJECTIONS.has(rejection.code)) return true;
  if (rejection.code === 'NOT_FOUND' || rejection.code === 'UNKNOWN_EVENT' || rejection.code === 'CONFLICT') {
    return false;
  }
  const meta = rejection.meta;
  return Boolean(meta && (meta.financial || meta.risk === 'HIGH' || meta.risk === 'CRITICAL'));
}

async function auditRejection(
  db: Db,
  entityType: LifecycleEntityType,
  machineName: string,
  request: TransitionRequest,
  rejection: LifecycleRejection,
): Promise<void> {
  if (!isAuditableRejection(rejection)) return;

  await writeAudit(db, {
    action: AUDIT_ACTIONS.LIFECYCLE_TRANSITION_DENIED,
    entityType,
    entityId: request.entityId,
    ...actorFields(request.actor),
    severity: rejection.meta?.risk === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
    afterState: {
      machine: machineName,
      event: request.event,
      rejectionCode: rejection.code,
      ...(rejection.denyReason ? { denyReason: rejection.denyReason } : {}),
      ...(rejection.status ? { status: rejection.status } : {}),
      actorKind: request.actor.kind,
      ...actorDetail(request.actor),
      message: rejection.message,
    },
    ...request.context,
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Generous, because the development database serves one connection at a time
// and concurrent callers queue for it.
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

async function inTransaction<R>(db: Db, work: (tx: PrismaTransaction) => Promise<R>): Promise<R> {
  if ('$transaction' in db) {
    return db.$transaction(work, TRANSACTION_OPTIONS);
  }
  // Already inside a caller's transaction: join it.
  return work(db);
}

/** Lock the entity row for the rest of the transaction. */
async function lockRow(tx: PrismaTransaction, table: LifecycleTable, id: string): Promise<boolean> {
  // `table` is one of four literals from a closed union, never caller input;
  // the id is a bound parameter.
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`,
    id,
  );
  return rows.length > 0;
}

function isConcurrencyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === 'P2034') return true;
  const message = error instanceof Error ? error.message : '';
  return /deadlock detected|could not serialize access/i.test(message);
}

function rejectedOutcome(base: OutcomeBase, rejection: LifecycleRejection): TransitionOutcome {
  return {
    ...base,
    result: 'REJECTED',
    code: rejection.code,
    message: rejection.message,
    status: rejection.status,
    denyReason: rejection.denyReason,
  };
}

/**
 * Run one transition. Never throws for a refusal — that is a `REJECTED`
 * outcome. Throws only for genuine failures (database unavailable, a bug).
 */
export async function executeTransition<S extends string, E extends string, C, T, D>(
  spec: LifecycleSpec<S, E, C, T, D>,
  request: TransitionRequest,
  db: Db = prisma,
): Promise<TransitionOutcome> {
  const base: OutcomeBase = {
    entityType: spec.entityType,
    entityId: request.entityId,
    event: request.event,
  };

  // Checked before touching the database: a malformed id would otherwise reach
  // Postgres as an invalid uuid cast.
  if (!UUID_PATTERN.test(request.entityId)) {
    return rejectedOutcome(
      base,
      new LifecycleRejection('NOT_FOUND', `No ${spec.entityType.toLowerCase()} with that id.`),
    );
  }
  if (!findTransition(spec.machine, request.event)) {
    return rejectedOutcome(
      base,
      new LifecycleRejection('UNKNOWN_EVENT', `${spec.machine.name} has no event "${request.event}".`),
    );
  }

  try {
    return await inTransaction(db, (tx) => runInTransaction(spec, request, tx, null));
  } catch (error) {
    if (error instanceof LifecycleRejection) {
      // The transaction has rolled back; the refusal is recorded on its own.
      await auditRejection(db, spec.entityType, spec.machine.name, request, error);
      return rejectedOutcome(base, error);
    }
    if (isConcurrencyConflict(error)) {
      return rejectedOutcome(
        base,
        new LifecycleRejection('CONFLICT', 'A concurrent change to this record won. Reload and retry.'),
      );
    }
    throw error;
  }
}

async function runInTransaction<S extends string, E extends string, C, T, D>(
  spec: LifecycleSpec<S, E, C, T, D>,
  request: TransitionRequest,
  tx: PrismaTransaction,
  cascadeOf: CascadeOrigin | null,
): Promise<TransitionOutcome> {
  const base: OutcomeBase = {
    entityType: spec.entityType,
    entityId: request.entityId,
    event: request.event,
  };

  const locked = await lockRow(tx, spec.table, request.entityId);
  const entity = locked ? await spec.load(tx, request.entityId) : null;
  if (entity === null) {
    throw new LifecycleRejection('NOT_FOUND', `No ${spec.entityType.toLowerCase()} with that id.`);
  }

  const definition = findTransition(spec.machine, request.event);
  if (!definition) {
    throw new LifecycleRejection('UNKNOWN_EVENT', `${spec.machine.name} has no event "${request.event}".`);
  }
  const event = definition.event;
  const meta: RejectionMeta = { risk: definition.risk, financial: definition.financial };
  const current = spec.status(entity);

  const context = await spec.context(tx, entity, event);
  const evaluation = evaluateTransition(spec.machine, current, event, request.actor.kind, context);

  // Structural refusals of the caller kind come first: an AI or a disallowed
  // actor kind learns nothing about the record.
  if (
    evaluation.kind === 'REJECTED' &&
    (evaluation.code === 'AI_NOT_PERMITTED' || evaluation.code === 'ACTOR_NOT_PERMITTED')
  ) {
    throw new LifecycleRejection(evaluation.code, evaluation.message, { status: current, meta });
  }

  if (request.actor.kind === 'HUMAN' || request.actor.kind === 'AI_AGENT') {
    const human = request.actor.kind === 'HUMAN' ? request.actor.actor : request.actor.onBehalfOf;
    const participants = await spec.participants(tx, entity, event);
    const decision = authorizeForTransition(human, definition, participants);
    if (!decision.allowed) {
      throw new LifecycleRejection('FORBIDDEN', denialMessage(decision.reason, definition.party), {
        status: current,
        denyReason: decision.reason,
        meta,
      });
    }
  }

  if (evaluation.kind === 'NO_OP' || spec.isRepeat?.(entity, request) === true) {
    return { ...base, result: 'NO_OP', status: current };
  }

  if (request.expectedStatus !== undefined && request.expectedStatus !== current) {
    throw new LifecycleRejection(
      'CONFLICT',
      `Expected this ${spec.entityType.toLowerCase()} to be ${request.expectedStatus}, but it is ${current}.`,
      { status: current, meta },
    );
  }

  if (evaluation.kind === 'REJECTED') {
    throw new LifecycleRejection(evaluation.code, evaluation.message, { status: current, meta });
  }

  const scope: TransitionScope<S, E, T> = {
    tx,
    entity,
    event,
    from: evaluation.from,
    to: evaluation.to,
    definition: meta,
    request,
    params: request.params ?? {},
    now: new Date(),
    origin: { entityType: spec.entityType, entityId: request.entityId, event },
  };

  let data: D;
  try {
    data = await spec.prepare(scope);
  } catch (error) {
    if (error instanceof LifecycleRejection) {
      throw new LifecycleRejection(error.code, error.message, {
        status: current,
        denyReason: error.denyReason,
        meta,
      });
    }
    throw error;
  }

  // Compare-and-set: the write succeeds only if the row is still in the state
  // the decision was made against. The row lock makes a miss unlikely; this
  // makes it impossible to apply a transition to a state it was not valid for.
  const written = await spec.write(scope, data);
  if (written !== 1) {
    throw new LifecycleRejection(
      'CONFLICT',
      `This ${spec.entityType.toLowerCase()} changed while the transition was being applied.`,
      { status: current, meta },
    );
  }

  try {
    const facts = await spec.effects(scope, data);
    const cascades = await spec.cascades(scope, data);

    await writeAudit(tx, {
      action: spec.auditAction,
      entityType: spec.entityType,
      entityId: request.entityId,
      ...actorFields(request.actor),
      severity: SEVERITY[definition.risk],
      beforeState: { status: scope.from },
      afterState: {
        status: scope.to,
        event,
        actorKind: request.actor.kind,
        ...actorDetail(request.actor),
        ...(cascadeOf ? { cascadeOf } : {}),
        ...(cascades.length > 0
          ? {
              cascades: cascades.map((entry) => ({
                entityType: entry.entityType,
                entityId: entry.entityId,
                event: entry.event,
                result: entry.result,
              })),
            }
          : {}),
        ...facts,
      },
      ...request.context,
    });

    return { ...base, result: 'APPLIED', from: scope.from, to: scope.to, cascades };
  } catch (error) {
    if (error instanceof LifecycleRejection) error.afterWrite = true;
    throw error;
  }
}

/**
 * Fire a follow-on transition inside the current transaction, as SYSTEM.
 *
 * A cascade applies when it applies: if the target is already past the event,
 * or the event's own rules say it does not apply yet (a contract is not
 * complete until its last milestone is), it is skipped and the skip is
 * recorded. Anything else — a missing row, a lost compare-and-set, a failed
 * write — aborts the whole unit of work.
 */
export async function cascade(
  scope: { readonly tx: PrismaTransaction; readonly origin: CascadeOrigin; readonly request: TransitionRequest },
  target: { readonly entityType: LifecycleEntityType; readonly entityId: string; readonly event: string },
): Promise<CascadeResult> {
  const spec = specFor(target.entityType);
  const request: TransitionRequest = {
    entityId: target.entityId,
    event: target.event,
    actor: { kind: 'SYSTEM', reason: `cascade from ${scope.origin.entityType}.${scope.origin.event}` },
    context: scope.request.context,
  };

  try {
    const outcome = await runInTransaction(spec, request, scope.tx, scope.origin);
    if (outcome.result === 'APPLIED') {
      return { ...target, result: 'APPLIED', from: outcome.from, to: outcome.to };
    }
    const status = outcome.result === 'NO_OP' ? outcome.status : 'unknown';
    return { ...target, result: 'NO_OP', reason: `Already ${status}.` };
  } catch (error) {
    if (
      error instanceof LifecycleRejection &&
      !error.afterWrite &&
      (error.code === 'INVALID_TRANSITION' || error.code === 'PRECONDITION_FAILED')
    ) {
      return { ...target, result: 'SKIPPED', reason: error.message };
    }
    throw error;
  }
}

/**
 * A cascade the parent transition cannot do without — a project cancellation
 * that fails to withdraw one of its contracts must not commit. A skip aborts
 * the whole unit of work.
 */
export async function cascadeRequired(
  scope: { readonly tx: PrismaTransaction; readonly origin: CascadeOrigin; readonly request: TransitionRequest },
  target: { readonly entityType: LifecycleEntityType; readonly entityId: string; readonly event: string },
): Promise<CascadeResult> {
  const result = await cascade(scope, target);
  if (result.result === 'SKIPPED') {
    throw precondition(
      `${target.entityType} ${target.entityId} could not be moved by ${target.event}: ${result.reason ?? 'not applicable'}`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers shared by the four services
// ---------------------------------------------------------------------------

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Membership test that narrows a wide string to a literal union. */
export function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Refuse when a related-record write did not touch exactly one row. */
export function assertSingleRow(count: number, what: string): void {
  if (count !== 1) {
    throw new LifecycleRejection('CONFLICT', `The ${what} changed while this transition was being applied.`);
  }
}

/** A value the service's own `prepare` guaranteed. Absence is a bug, not a refusal. */
export function prepared<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`Lifecycle invariant violated: ${what} was not prepared.`);
  return value;
}

/** Dispute states that still need a decision. */
export const OPEN_DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'ESCALATED'] as const;

/**
 * Payment states in which no money is held or moving: nothing was ever
 * captured, the attempt ended, or the money went back. Anything else means
 * funds are in flight, held in escrow, or already disbursed.
 */
export const PAYMENT_STATES_WITHOUT_FUNDS = ['CREATED', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;

/** A required free-text parameter, trimmed. */
export function requireText(value: string | undefined, name: string, event: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw precondition(`${event} requires "${name}".`);
  return trimmed;
}

export function requireResolution(params: TransitionParams, event: string): DisputeResolution {
  if (!params.resolution) throw precondition(`${event} requires "resolution".`);
  return params.resolution;
}

/**
 * The state an entity was in before it most recently entered `enteredStatus`.
 *
 * Used to restore a project after a suspension or dispute, and a contract after
 * a dispute. The audit log is the system of record for that history: it is
 * append-only and written in the same transaction as every transition, so it
 * cannot disagree with the status column. No schema change was needed.
 */
export async function statusBeforeEntering(
  tx: PrismaTransaction,
  params: {
    readonly entityType: LifecycleEntityType;
    readonly entityId: string;
    readonly action: AuditAction;
    readonly enteredStatus: string;
  },
): Promise<string | undefined> {
  const entry = await tx.auditLog.findFirst({
    where: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      afterState: { path: ['status'], equals: params.enteredStatus },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { beforeState: true },
  });

  const before = entry?.beforeState;
  if (before && typeof before === 'object' && !Array.isArray(before)) {
    const status = (before as Record<string, unknown>).status;
    return typeof status === 'string' ? status : undefined;
  }
  return undefined;
}

/** Close every open dispute in exactly this scope (project, contract or milestone level). */
export async function resolveOpenDisputes(
  tx: PrismaTransaction,
  where: { readonly projectId: string; readonly contractId: string | null; readonly milestoneId: string | null },
  resolution: DisputeResolution,
  notes: string,
  resolvedByUserId: string | null,
  now: Date,
): Promise<number> {
  const resolved = await tx.dispute.updateMany({
    where: {
      projectId: where.projectId,
      contractId: where.contractId,
      milestoneId: where.milestoneId,
      status: { in: [...OPEN_DISPUTE_STATUSES] },
    },
    data: { status: resolution, resolvedByUserId, resolvedAt: now, resolutionNotes: notes },
  });
  return resolved.count;
}

/** User ids of the expert side of a contract: its expert, or its team's leads. */
export function contractExpertUserIds(contract: {
  readonly expert: { readonly userId: string } | null;
  readonly team: { readonly members: readonly { readonly expert: { readonly userId: string } }[] } | null;
}): string[] {
  if (contract.expert) return [contract.expert.userId];
  return contract.team?.members.map((member) => member.expert.userId) ?? [];
}

/** Prisma `select` for `contractExpertUserIds`. */
export const CONTRACT_EXPERT_SELECT = {
  expert: { select: { userId: true } },
  team: {
    select: {
      members: { where: { isLead: true }, select: { expert: { select: { userId: true } } } },
    },
  },
} as const;
