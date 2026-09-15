/**
 * Contract lifecycle service — STEP 02 §10.2.
 *
 * Contextual rules on top of the state machine:
 *
 *   Signing
 *     - SEND / RESEND are the customer's signed offer of the current version.
 *     - ACCEPT is the expert's countersignature: it marks the current version
 *       signed in the same transaction. A signed version is never edited; a
 *       change needs a new version and a new acceptance.
 *
 *   Business policy
 *     - MARK_FUNDED needs a milestone funded by a verified payment.
 *     - COMPLETE needs every milestone ended and at least one approved.
 *     - TERMINATE needs a reason, and resolves the contract's open dispute.
 *
 *   Dispute rules
 *     - RAISE_DISPUTE needs a reason, one open contract-level dispute at a time,
 *       and creates the dispute record.
 *     - RESOLVE_DISPUTE returns the contract to the state it was disputed from.
 *
 * Cascades: acceptance moves the project to PAYMENT_PENDING; completion lets
 * the project complete once all of its contracts have.
 */

import type { Prisma } from '../../src/generated/prisma/client';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import {
  CONTRACT_MACHINE,
  CONTRACT_STATES,
  type ContractContext,
  type ContractEvent,
  type ContractState,
} from '../../domain/contract/state-machine';
import { MILESTONE_FUNDED_OR_LATER, MILESTONE_MACHINE } from '../../domain/milestone/state-machine';
import {
  CONTRACT_EXPERT_SELECT,
  type CascadeResult,
  type DisputeResolution,
  type LifecycleSpec,
  OPEN_DISPUTE_STATUSES,
  type TransitionScope,
  accountableUserId,
  assertSingleRow,
  cascade,
  contractExpertUserIds,
  isOneOf,
  precondition,
  prepared,
  requireResolution,
  requireText,
  resolveOpenDisputes,
  statusBeforeEntering,
} from './engine';

const CONTRACT_SELECT = {
  id: true,
  status: true,
  projectId: true,
  startDate: true,
  customer: { select: { userId: true } },
  ...CONTRACT_EXPERT_SELECT,
} as const satisfies Prisma.ContractSelect;

export type ContractRow = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

interface ContractData {
  readonly versionId: string | null;
  readonly dispute: { readonly reason: string; readonly description: string } | null;
  readonly resolution: { readonly resolution: DisputeResolution; readonly notes: string } | null;
  readonly terminationReason: string | null;
}

const NOTHING: ContractData = { versionId: null, dispute: null, resolution: null, terminationReason: null };

type Scope = TransitionScope<ContractState, ContractEvent, ContractRow>;

function isContractState(value: string | undefined): value is ContractState {
  return value !== undefined && isOneOf(CONTRACT_STATES, value);
}

async function openContractDisputes(tx: Scope['tx'], contractId: string): Promise<number> {
  return tx.dispute.count({
    where: { contractId, milestoneId: null, status: { in: [...OPEN_DISPUTE_STATUSES] } },
  });
}

async function prepareContract(scope: Scope): Promise<ContractData> {
  const { tx, entity, event, params } = scope;

  switch (event) {
    case 'SEND':
    case 'RESEND':
    case 'ACCEPT': {
      const version = await tx.contractVersion.findFirst({
        where: { contractId: entity.id, supersededAt: null },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, isSigned: true },
      });
      if (!version) throw precondition('This contract has no current version to sign.');
      if (version.isSigned) {
        throw precondition('The current version is already signed. Signed terms are immutable; create a new version.');
      }
      return { ...NOTHING, versionId: version.id };
    }

    case 'MARK_FUNDED': {
      const funded = await tx.milestone.count({
        where: { contractId: entity.id, status: { in: [...MILESTONE_FUNDED_OR_LATER] } },
      });
      if (funded === 0) throw precondition('No milestone on this contract has been funded by a verified payment.');
      return NOTHING;
    }

    case 'COMPLETE': {
      const milestones = await tx.milestone.findMany({
        where: { contractId: entity.id },
        select: { status: true },
      });
      const allEnded =
        milestones.length > 0 &&
        milestones.every((milestone) => isOneOf(MILESTONE_MACHINE.terminal, milestone.status));
      const anyApproved = milestones.some((milestone) => milestone.status === 'APPROVED');
      if (!allEnded || !anyApproved) {
        throw precondition('A contract completes when every milestone has ended and at least one was approved.');
      }
      return NOTHING;
    }

    case 'RAISE_DISPUTE': {
      const reason = requireText(params.reason, 'reason', event);
      const description = requireText(params.description, 'description', event);
      if ((await openContractDisputes(tx, entity.id)) > 0) {
        throw precondition('This contract already has an open dispute.');
      }
      return { ...NOTHING, dispute: { reason, description } };
    }

    case 'RESOLVE_DISPUTE':
      return {
        ...NOTHING,
        resolution: {
          resolution: requireResolution(params, event),
          notes: requireText(params.notes, 'notes', event),
        },
      };

    case 'TERMINATE': {
      const reason = requireText(params.reason, 'reason', event);
      if ((await openContractDisputes(tx, entity.id)) === 0) {
        return { ...NOTHING, terminationReason: reason };
      }
      // Ending a disputed contract decides the dispute; that decision is stated.
      if (!params.resolution) {
        throw precondition('This contract has an open dispute, so TERMINATE must state its "resolution".');
      }
      return {
        ...NOTHING,
        terminationReason: reason,
        resolution: { resolution: params.resolution, notes: params.notes?.trim() || reason },
      };
    }

    default:
      return NOTHING;
  }
}

function contractColumns(
  event: ContractEvent,
  entity: ContractRow,
  data: ContractData,
  now: Date,
): Prisma.ContractUpdateManyMutationInput {
  switch (event) {
    case 'SEND':
    case 'RESEND':
      // Sending is the customer's signed offer.
      return { sentAt: now, customerSignedAt: now };
    case 'ACCEPT':
      return { acceptedAt: now, expertSignedAt: now };
    case 'START':
      return { startDate: entity.startDate ?? now };
    case 'COMPLETE':
      return { completedAt: now };
    case 'CLOSE':
      return { closedAt: now };
    case 'TERMINATE':
      return { terminatedAt: now, terminationReason: data.terminationReason };
    default:
      return {};
  }
}

async function contractEffects(scope: Scope, data: ContractData): Promise<Record<string, unknown>> {
  const { tx, entity, event, params, now, request } = scope;
  const userId = accountableUserId(request.actor);
  const facts: Record<string, unknown> = params.reason ? { reason: params.reason } : {};

  switch (event) {
    case 'ACCEPT': {
      const versionId = prepared(data.versionId, 'versionId');
      const signed = await tx.contractVersion.updateMany({
        where: { id: versionId, isSigned: false, supersededAt: null },
        data: { isSigned: true, signedAt: now },
      });
      assertSingleRow(signed.count, 'contract version');
      return { ...facts, contractVersionId: versionId };
    }

    case 'SEND':
    case 'RESEND':
      return { ...facts, contractVersionId: prepared(data.versionId, 'versionId') };

    case 'RAISE_DISPUTE': {
      const dispute = prepared(data.dispute, 'dispute');
      const created = await tx.dispute.create({
        data: {
          projectId: entity.projectId,
          contractId: entity.id,
          raisedByUserId: prepared(userId, 'raisedByUserId'),
          reason: dispute.reason,
          description: dispute.description,
        },
        select: { id: true },
      });
      return { ...facts, disputeId: created.id };
    }

    case 'RESOLVE_DISPUTE':
    case 'TERMINATE': {
      if (!data.resolution) return facts;
      const resolved = await resolveOpenDisputes(
        tx,
        { projectId: entity.projectId, contractId: entity.id, milestoneId: null },
        data.resolution.resolution,
        data.resolution.notes,
        userId,
        now,
      );
      return { ...facts, resolution: data.resolution.resolution, disputesResolved: resolved };
    }

    default:
      return facts;
  }
}

async function contractCascades(scope: Scope): Promise<readonly CascadeResult[]> {
  switch (scope.event) {
    case 'ACCEPT':
      return [
        await cascade(scope, {
          entityType: 'Project',
          entityId: scope.entity.projectId,
          event: 'MARK_CONTRACT_ACCEPTED',
        }),
      ];
    case 'COMPLETE':
      return [await cascade(scope, { entityType: 'Project', entityId: scope.entity.projectId, event: 'COMPLETE' })];
    default:
      return [];
  }
}

export const CONTRACT_LIFECYCLE: LifecycleSpec<
  ContractState,
  ContractEvent,
  ContractContext,
  ContractRow,
  ContractData
> = {
  entityType: 'Contract',
  table: 'contracts',
  machine: CONTRACT_MACHINE,
  auditAction: AUDIT_ACTIONS.CONTRACT_TRANSITIONED,

  load: (tx, id) => tx.contract.findUnique({ where: { id }, select: CONTRACT_SELECT }),

  status: (contract) => contract.status,

  async participants(_tx, contract) {
    return { customerUserId: contract.customer.userId, expertUserIds: contractExpertUserIds(contract) };
  },

  async context(tx, contract, event) {
    if (event !== 'RESOLVE_DISPUTE') return {};
    const previous = await statusBeforeEntering(tx, {
      entityType: 'Contract',
      entityId: contract.id,
      action: AUDIT_ACTIONS.CONTRACT_TRANSITIONED,
      enteredStatus: 'DISPUTED',
    });
    return { previousStatus: isContractState(previous) ? previous : undefined };
  },

  prepare: prepareContract,

  async write({ tx, entity, event, from, to, now }, data) {
    const result = await tx.contract.updateMany({
      where: { id: entity.id, status: from },
      data: { status: to, ...contractColumns(event, entity, data, now) },
    });
    return result.count;
  },

  effects: contractEffects,
  cascades: contractCascades,
};
