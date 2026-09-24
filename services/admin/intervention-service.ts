/**
 * Lifecycle interventions (Phase 8): an administrator acting on a project,
 * contract, milestone or payment.
 *
 * An intervention is NOT a second way to change those records. The control
 * plane adds governance and then calls the Phase 6 lifecycle service, which
 * alone decides whether the transition happens: the state machine, RBAC with
 * MFA, the contextual rules (payment state, dispute rules, webhook truth),
 * compare-and-set, cascades and its own audit record all apply unchanged.
 *
 * What the control plane adds before the lifecycle is reached:
 *
 *   - Only platform-authority events can be sent here — a human event with an
 *     `:any` grant — and only the `:any` grant counts. An administrator who is
 *     also a customer cannot use the admin channel for their customer actions,
 *     and SYSTEM- or WEBHOOK-only events (capture confirmation, funding) are not
 *     interventions at all.
 *   - A reason for every intervention, and confirmation of the expected state
 *     for HIGH and CRITICAL ones.
 *   - No intervening in an engagement you are party to.
 *   - `admin.intervention.requested` is written BEFORE the lifecycle is called,
 *     so the justification is durable before anything changes, and
 *     `admin.intervention.completed` records the lifecycle's outcome.
 *
 * The events are derived from the Phase 6 tables, never listed by hand, so the
 * two cannot drift.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { adminDenialMessage, checkJustification, checkNotParty, normalizeReason } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { scopeOf } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { CONTRACT_MACHINE } from '../../domain/contract/state-machine';
import { type StateMachine, type TransitionDefinition, findTransition } from '../../domain/lifecycle/machine';
import { MILESTONE_MACHINE } from '../../domain/milestone/state-machine';
import { PAYMENT_MACHINE } from '../../domain/payment/state-machine';
import { PROJECT_MACHINE } from '../../domain/project/state-machine';
import {
  type DisputeResolution,
  type LifecycleEntityType,
  type RiskLevelInput,
  type TransitionOutcome,
  type TransitionParams,
  type TransitionRequest,
  transitionContract,
  transitionMilestone,
  transitionPayment,
  transitionProject,
} from '../lifecycle';
import { type Participants, authorizeForTransition, denialMessage } from '../lifecycle/authorization';
import { type AdminOutcome, AdminRejection, auditAdminDenial, isUuid, rejectedOutcome, severityFor } from './outcome';

type AnyMachine = StateMachine<string, string, never>;
type AnyDefinition = TransitionDefinition<string, string, never>;

const MACHINES: Readonly<Record<LifecycleEntityType, AnyMachine>> = {
  Project: PROJECT_MACHINE as unknown as AnyMachine,
  Contract: CONTRACT_MACHINE as unknown as AnyMachine,
  Milestone: MILESTONE_MACHINE as unknown as AnyMachine,
  Payment: PAYMENT_MACHINE as unknown as AnyMachine,
};

const TRANSITIONS: Readonly<Record<LifecycleEntityType, (request: TransitionRequest, db: Db) => Promise<TransitionOutcome>>> = {
  Project: transitionProject,
  Contract: transitionContract,
  Milestone: transitionMilestone,
  Payment: transitionPayment,
};

const NO_PARTICIPANTS: Participants = { customerUserId: null, expertUserIds: [] };

function platformGrants(definition: AnyDefinition) {
  return (definition.permissions ?? []).filter((permission) => scopeOf(permission) === 'any');
}

function isIntervention(definition: AnyDefinition): boolean {
  return definition.actors.includes('HUMAN') && platformGrants(definition).length > 0;
}

/** Every event an administrator may take on this kind of record. */
export function interventionEvents(entityType: LifecycleEntityType): readonly string[] {
  return MACHINES[entityType].transitions.filter(isIntervention).map((definition) => definition.event);
}

/**
 * Interventions structurally possible from a status, for detail views. The
 * lifecycle's contextual rules still decide each one when it is attempted.
 */
export function availableInterventions(entityType: LifecycleEntityType, status: string): readonly string[] {
  return MACHINES[entityType].transitions
    .filter((definition) => isIntervention(definition) && definition.from.includes(status))
    .map((definition) => definition.event);
}

export interface InterventionParams {
  readonly notes?: string | undefined;
  readonly resolution?: DisputeResolution | undefined;
  readonly riskLevel?: RiskLevelInput | undefined;
  readonly assignmentId?: string | undefined;
}

export interface InterventionRequest {
  readonly entityType: LifecycleEntityType;
  readonly entityId: string;
  readonly event: string;
  readonly actor: Actor;
  readonly reason?: string | undefined;
  readonly confirm?: boolean | undefined;
  readonly expectedStatus?: string | undefined;
  readonly params?: InterventionParams | undefined;
  readonly context?: RequestContext | undefined;
}

export async function interveneInLifecycle(request: InterventionRequest, db: Db = prisma): Promise<AdminOutcome> {
  const base = { entityType: request.entityType, entityId: request.entityId, event: request.event };
  const machine = MACHINES[request.entityType];

  if (!isUuid(request.entityId)) {
    return rejectedOutcome(
      { ...base, entityId: null },
      new AdminRejection('NOT_FOUND', `No ${request.entityType.toLowerCase()} with that id.`),
    );
  }

  const definition = findTransition(machine, request.event);
  if (!definition) {
    return rejectedOutcome(base, new AdminRejection('UNKNOWN_EVENT', `${machine.name} has no event "${request.event}".`));
  }

  const refuse = async (rejection: AdminRejection): Promise<AdminOutcome> => {
    await auditAdminDenial(db, {
      actor: request.actor,
      entityType: request.entityType,
      entityId: request.entityId,
      event: request.event,
      rejection,
      risk: definition.risk,
      financial: definition.financial,
      context: request.context,
    });
    return rejectedOutcome(base, rejection);
  };

  if (!isIntervention(definition)) {
    return refuse(
      new AdminRejection(
        'NOT_AN_INTERVENTION',
        `${machine.name}.${definition.event} is not a platform-authority action, so it cannot be taken through the admin control plane.`,
      ),
    );
  }

  // RBAC on the platform-authority grants alone.
  const decision = authorizeForTransition(request.actor, { permissions: platformGrants(definition) }, NO_PARTICIPANTS);
  if (!decision.allowed) {
    return refuse(
      new AdminRejection('FORBIDDEN', denialMessage(decision.reason, undefined), { denyReason: decision.reason }),
    );
  }

  // An intervention overrides the parties' own flow, so even a LOW-risk one states why.
  const failure = checkJustification(definition.risk === 'LOW' ? 'MEDIUM' : definition.risk, request);
  if (failure) return refuse(new AdminRejection(failure.code, failure.message));

  const parties = await loadParties(db, request.entityType, request.entityId);
  if (parties === null) {
    return rejectedOutcome(base, new AdminRejection('NOT_FOUND', `No ${request.entityType.toLowerCase()} with that id.`));
  }

  const conflict = checkNotParty(request.actor, parties);
  if (conflict) {
    return refuse(new AdminRejection('FORBIDDEN', adminDenialMessage(conflict), { denyReason: conflict }));
  }

  // Guaranteed by the justification check above.
  const reason = normalizeReason(request.reason) ?? '';
  const params = request.params ?? {};

  await writeAudit(db, {
    action: AUDIT_ACTIONS.ADMIN_INTERVENTION_REQUESTED,
    entityType: request.entityType,
    entityId: request.entityId,
    actorUserId: request.actor.userId,
    severity: severityFor(definition.risk),
    afterState: {
      event: definition.event,
      reason,
      risk: definition.risk,
      ...(request.expectedStatus ? { expectedStatus: request.expectedStatus } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.riskLevel ? { riskLevel: params.riskLevel } : {}),
    },
    ...request.context,
  });

  const transitionParams: TransitionParams = {
    reason,
    ...(params.notes ? { notes: params.notes } : {}),
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(params.riskLevel ? { riskLevel: params.riskLevel } : {}),
    ...(params.assignmentId ? { assignmentId: params.assignmentId } : {}),
  };

  const outcome = await TRANSITIONS[request.entityType](
    {
      entityId: request.entityId,
      event: definition.event,
      // Always the session's human — the admin's own RBAC and MFA apply inside the lifecycle.
      actor: { kind: 'HUMAN', actor: request.actor },
      expectedStatus: request.expectedStatus,
      params: transitionParams,
      context: request.context,
    },
    db,
  );

  await writeAudit(db, {
    action: AUDIT_ACTIONS.ADMIN_INTERVENTION_COMPLETED,
    entityType: request.entityType,
    entityId: request.entityId,
    actorUserId: request.actor.userId,
    severity: outcome.result === 'REJECTED' ? 'WARNING' : severityFor(definition.risk),
    afterState: {
      event: definition.event,
      result: outcome.result,
      ...(outcome.result === 'APPLIED' ? { from: outcome.from, to: outcome.to } : {}),
      ...(outcome.result === 'NO_OP' ? { status: outcome.status } : {}),
      ...(outcome.result === 'REJECTED' ? { rejectionCode: outcome.code, message: outcome.message } : {}),
    },
    ...request.context,
  });

  return fromLifecycle(outcome);
}

function fromLifecycle(outcome: TransitionOutcome): AdminOutcome {
  const base = { entityType: outcome.entityType, entityId: outcome.entityId, event: outcome.event };
  switch (outcome.result) {
    case 'APPLIED':
      return { ...base, result: 'APPLIED', from: outcome.from, to: outcome.to, cascades: outcome.cascades };
    case 'NO_OP':
      return { ...base, result: 'NO_OP', status: outcome.status };
    default:
      return {
        ...base,
        result: 'REJECTED',
        code: outcome.code,
        message: outcome.message,
        status: outcome.status,
        denyReason: outcome.denyReason,
      };
  }
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

/** Prisma `select` for the expert side of a contract: its expert, or its team. */
export const EXPERT_SIDE = {
  expert: { select: { userId: true } },
  team: { select: { members: { select: { expert: { select: { userId: true } } } } } },
} as const;

export interface ExpertSide {
  readonly expert: { readonly userId: string } | null;
  readonly team: { readonly members: readonly { readonly expert: { readonly userId: string } }[] } | null;
}

export function expertSideUserIds(contract: ExpertSide): string[] {
  return [
    ...(contract.expert ? [contract.expert.userId] : []),
    ...(contract.team?.members.map((member) => member.expert.userId) ?? []),
  ];
}

/** Every user on either side of the engagement the record belongs to; null when it does not exist. */
export async function loadParties(db: Db, entityType: LifecycleEntityType, id: string): Promise<string[] | null> {
  switch (entityType) {
    case 'Project': {
      const project = await db.project.findUnique({
        where: { id },
        select: {
          customer: { select: { userId: true } },
          invitedExpert: { select: { userId: true } },
          assignments: { select: { expert: { select: { userId: true } } } },
          contracts: { select: EXPERT_SIDE },
        },
      });
      if (!project) return null;
      return [
        project.customer.userId,
        ...(project.invitedExpert ? [project.invitedExpert.userId] : []),
        ...project.assignments.flatMap((assignment) => (assignment.expert ? [assignment.expert.userId] : [])),
        ...project.contracts.flatMap(expertSideUserIds),
      ];
    }
    case 'Contract': {
      const contract = await db.contract.findUnique({
        where: { id },
        select: { customer: { select: { userId: true } }, ...EXPERT_SIDE },
      });
      return contract ? [contract.customer.userId, ...expertSideUserIds(contract)] : null;
    }
    case 'Milestone': {
      const milestone = await db.milestone.findUnique({
        where: { id },
        select: { contract: { select: { customer: { select: { userId: true } }, ...EXPERT_SIDE } } },
      });
      return milestone ? [milestone.contract.customer.userId, ...expertSideUserIds(milestone.contract)] : null;
    }
    default: {
      const payment = await db.payment.findUnique({
        where: { id },
        select: {
          customer: { select: { userId: true } },
          order: { select: { contract: { select: EXPERT_SIDE } } },
        },
      });
      if (!payment) return null;
      return [payment.customer.userId, ...(payment.order.contract ? expertSideUserIds(payment.order.contract) : [])];
    }
  }
}
