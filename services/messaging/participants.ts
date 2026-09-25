/**
 * Who belongs in a conversation.
 *
 * Membership is materialised in `conversation_members`, but it has to be
 * *derived* from the engagement the first time a thread is opened, and kept in
 * step as the engagement changes. This module owns that derivation, so the rule
 * lives in one place rather than being re-implemented wherever a thread is
 * created.
 *
 * WHO COUNTS
 *   The customer on the project, plus every expert with a live connection to it:
 *   an assignment they have been invited to or accepted, a contract they are
 *   party to, or a seat on an assigned team. An expert whose assignment was
 *   declined, withdrawn or replaced is not a member — the same set the Phase 6
 *   lifecycle treats as party to the engagement.
 *
 * MEMBERSHIP IS ADDITIVE
 *   `syncMembers` adds people who should be there and does not remove anyone.
 *   Removal is an explicit act (`removeMember`), audited, and never a side
 *   effect of a status change — an expert should not silently lose the thread,
 *   and its history, because a status moved while a dispute about that very
 *   engagement is open.
 */

import type { Db } from '../../lib/db/client';

/** Assignment states that put an expert in the room. */
const INVOLVED_ASSIGNMENT_STATES = ['INVITED', 'ACCEPTED', 'ACTIVE', 'COMPLETED'] as const;

/** Contract states that put an expert in the room — every state but a dead draft. */
const INVOLVED_CONTRACT_STATES = [
  'SENT',
  'NEGOTIATION',
  'ACCEPTED',
  'FUNDED',
  'ACTIVE',
  'COMPLETED',
  'CLOSED',
  'DISPUTED',
  'TERMINATED',
] as const;

export interface EngagementParties {
  readonly customerUserId: string | null;
  readonly expertUserIds: readonly string[];
}

/** Every user who should be in a project's conversation. */
export async function projectParties(db: Db, projectId: string): Promise<EngagementParties> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { customer: { select: { userId: true } } },
  });
  if (!project) return { customerUserId: null, expertUserIds: [] };

  const experts = new Set<string>();

  const assignments = await db.assignment.findMany({
    where: { projectId, status: { in: [...INVOLVED_ASSIGNMENT_STATES] } },
    select: {
      expert: { select: { userId: true } },
      team: { select: { members: { select: { expert: { select: { userId: true } } } } } },
    },
  });
  for (const assignment of assignments) {
    if (assignment.expert) experts.add(assignment.expert.userId);
    for (const member of assignment.team?.members ?? []) experts.add(member.expert.userId);
  }

  const contracts = await db.contract.findMany({
    where: { projectId, status: { in: [...INVOLVED_CONTRACT_STATES] } },
    select: {
      expert: { select: { userId: true } },
      team: { select: { members: { select: { expert: { select: { userId: true } } } } } },
    },
  });
  for (const contract of contracts) {
    if (contract.expert) experts.add(contract.expert.userId);
    for (const member of contract.team?.members ?? []) experts.add(member.expert.userId);
  }

  return { customerUserId: project.customer.userId, expertUserIds: [...experts] };
}

/** Every user who should be in a contract's conversation. */
export async function contractParties(db: Db, contractId: string): Promise<EngagementParties> {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      customer: { select: { userId: true } },
      expert: { select: { userId: true } },
      team: { select: { members: { select: { expert: { select: { userId: true } } } } } },
    },
  });
  if (!contract) return { customerUserId: null, expertUserIds: [] };

  const experts = new Set<string>();
  if (contract.expert) experts.add(contract.expert.userId);
  for (const member of contract.team?.members ?? []) experts.add(member.expert.userId);

  return { customerUserId: contract.customer.userId, expertUserIds: [...experts] };
}

/** Every user who should be in a team's conversation. */
export async function teamParties(db: Db, teamId: string): Promise<EngagementParties> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      project: { select: { customer: { select: { userId: true } } } },
      members: { select: { expert: { select: { userId: true } } } },
    },
  });
  if (!team) return { customerUserId: null, expertUserIds: [] };

  // A team thread is the experts' working space; the customer is not in it.
  // Customer-facing discussion belongs in the project or contract thread.
  return {
    customerUserId: null,
    expertUserIds: team.members.map((member) => member.expert.userId),
  };
}

/**
 * Every project a user is a party to, in either role.
 *
 * Used to answer "do these two work together?" without materialising a thread
 * first — so a DIRECT conversation can be opened between collaborators even if
 * neither has ever opened the project thread.
 */
export async function engagementProjectIds(db: Db, userId: string): Promise<ReadonlySet<string>> {
  const expertSide = {
    OR: [{ expert: { userId } }, { team: { members: { some: { expert: { userId } } } } }],
  };

  const [asCustomer, viaAssignment, viaContract] = await Promise.all([
    db.project.findMany({ where: { customer: { userId } }, select: { id: true } }),
    db.assignment.findMany({
      where: { status: { in: [...INVOLVED_ASSIGNMENT_STATES] }, ...expertSide },
      select: { projectId: true },
    }),
    db.contract.findMany({
      where: { status: { in: [...INVOLVED_CONTRACT_STATES] }, ...expertSide },
      select: { projectId: true },
    }),
  ]);

  return new Set([
    ...asCustomer.map((project) => project.id),
    ...viaAssignment.map((assignment) => assignment.projectId),
    ...viaContract.map((contract) => contract.projectId),
  ]);
}

/** True when the two users are party to at least one project in common. */
export async function shareAnEngagement(db: Db, userA: string, userB: string): Promise<boolean> {
  const [forA, forB] = await Promise.all([engagementProjectIds(db, userA), engagementProjectIds(db, userB)]);
  for (const projectId of forA) {
    if (forB.has(projectId)) return true;
  }
  return false;
}

export function allParties(parties: EngagementParties): readonly string[] {
  const everyone = parties.customerUserId
    ? [parties.customerUserId, ...parties.expertUserIds]
    : [...parties.expertUserIds];
  return [...new Set(everyone)];
}
