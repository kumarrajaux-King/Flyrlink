/**
 * Engagement oversight (Phase 8): read-only views of projects, contracts and
 * milestones for the roles that supervise them, with the interventions each
 * record currently admits.
 *
 * Every read is gated on its own capability, and a detail view includes
 * payment data only for a caller who may read payments: seeing a milestone does
 * not imply seeing its money.
 */

import { assertCapability, hasCapability } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { PROJECT_SOURCES, RISK_LEVELS } from '../../lib/validation/admin';
import type { Prisma } from '../../src/generated/prisma/client';
import type { ContractState } from '../../domain/contract/state-machine';
import { DISPUTE_OPEN_STATES } from '../../domain/dispute/triage-machine';
import type { MilestoneState } from '../../domain/milestone/state-machine';
import type { ProjectState } from '../../domain/project/state-machine';
import { availableInterventions } from './intervention-service';
import { isUuid } from './outcome';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from './pagination';

type RiskLevel = (typeof RISK_LEVELS)[number];
type ProjectSource = (typeof PROJECT_SOURCES)[number];

const OPEN_DISPUTE_FILTER = { status: { in: [...DISPUTE_OPEN_STATES] } };

const OPEN_DISPUTE_SELECT = {
  id: true,
  status: true,
  reason: true,
  contractId: true,
  milestoneId: true,
  createdAt: true,
} satisfies Prisma.DisputeSelect;

export interface OpenDispute {
  readonly disputeId: string;
  readonly status: string;
  readonly reason: string;
  readonly contractId: string | null;
  readonly milestoneId: string | null;
  readonly raisedAt: string;
}

function toOpenDispute(row: {
  id: string;
  status: string;
  reason: string;
  contractId: string | null;
  milestoneId: string | null;
  createdAt: Date;
}): OpenDispute {
  return {
    disputeId: row.id,
    status: row.status,
    reason: row.reason,
    contractId: row.contractId,
    milestoneId: row.milestoneId,
    raisedAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface AdminProjectSummary {
  readonly projectId: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly riskLevel: string;
  readonly engagementType: string;
  readonly currency: string;
  readonly budgetMinMinor: string | null;
  readonly budgetMaxMinor: string | null;
  readonly customer: {
    readonly customerId: string;
    readonly userId: string;
    readonly fullName: string;
    readonly companyName: string | null;
  };
  readonly contractCount: number;
  readonly disputeCount: number;
  readonly createdAt: string;
  readonly submittedAt: string | null;
}

const PROJECT_SUMMARY_SELECT = {
  id: true,
  projectNumber: true,
  title: true,
  source: true,
  status: true,
  riskLevel: true,
  engagementType: true,
  currency: true,
  budgetMinMinor: true,
  budgetMaxMinor: true,
  createdAt: true,
  submittedAt: true,
  customer: { select: { id: true, companyName: true, user: { select: { id: true, fullName: true } } } },
  _count: { select: { contracts: true, disputes: true } },
} satisfies Prisma.ProjectSelect;

interface ProjectSummaryRow {
  readonly id: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly riskLevel: string;
  readonly engagementType: string;
  readonly currency: string;
  readonly budgetMinMinor: bigint | null;
  readonly budgetMaxMinor: bigint | null;
  readonly createdAt: Date;
  readonly submittedAt: Date | null;
  readonly customer: {
    readonly id: string;
    readonly companyName: string | null;
    readonly user: { readonly id: string; readonly fullName: string };
  };
  readonly _count: { readonly contracts: number; readonly disputes: number };
}

function toProjectSummary(row: ProjectSummaryRow): AdminProjectSummary {
  return {
    projectId: row.id,
    projectNumber: row.projectNumber,
    title: row.title,
    source: row.source,
    status: row.status,
    riskLevel: row.riskLevel,
    engagementType: row.engagementType,
    currency: row.currency,
    budgetMinMinor: minor(row.budgetMinMinor),
    budgetMaxMinor: minor(row.budgetMaxMinor),
    customer: {
      customerId: row.customer.id,
      userId: row.customer.user.id,
      fullName: row.customer.user.fullName,
      companyName: row.customer.companyName,
    },
    contractCount: row._count.contracts,
    disputeCount: row._count.disputes,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
  };
}

export async function listProjects(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: ProjectState | undefined;
    readonly riskLevel?: RiskLevel | undefined;
    readonly source?: ProjectSource | undefined;
    readonly customerId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminProjectSummary>> {
  assertCapability(params.actor, 'PROJECTS_READ');
  const size = pageSize(params.limit);

  const rows = await db.project.findMany({
    where: {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.riskLevel ? { riskLevel: params.riskLevel } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: PROJECT_SUMMARY_SELECT,
  });

  return toPage(rows, size, toProjectSummary);
}

export interface AdminProjectDetail extends AdminProjectSummary {
  readonly description: string;
  readonly category: { readonly categoryId: string; readonly name: string } | null;
  readonly deadline: string | null;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly closedAt: string | null;
  readonly estimate: {
    readonly effortHours: number | null;
    readonly durationDays: number | null;
    readonly budgetMinMinor: string | null;
    readonly budgetMaxMinor: string | null;
    readonly teamSize: number | null;
  };
  readonly contracts: readonly {
    readonly contractId: string;
    readonly contractNumber: string;
    readonly status: string;
    readonly totalValueMinor: string;
    readonly currency: string;
    readonly expertName: string | null;
  }[];
  readonly assignments: readonly {
    readonly assignmentId: string;
    readonly status: string;
    readonly expertId: string | null;
    readonly isAiInitiated: boolean;
  }[];
  readonly milestonesByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly openDisputes: readonly OpenDispute[];
  readonly availableInterventions: readonly string[];
}

export async function getProject(
  params: { readonly actor: Actor; readonly projectId: string },
  db: Db = prisma,
): Promise<AdminProjectDetail | null> {
  assertCapability(params.actor, 'PROJECTS_READ');
  if (!isUuid(params.projectId)) return null;

  const project = await db.project.findFirst({
    where: { id: params.projectId, deletedAt: null },
    select: {
      ...PROJECT_SUMMARY_SELECT,
      description: true,
      deadline: true,
      activatedAt: true,
      completedAt: true,
      closedAt: true,
      estimatedEffortHours: true,
      estimatedDurationDays: true,
      estimatedBudgetMinMinor: true,
      estimatedBudgetMaxMinor: true,
      estimatedTeamSize: true,
      category: { select: { id: true, name: true } },
      contracts: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          totalValueMinor: true,
          currency: true,
          expert: { select: { user: { select: { fullName: true } } } },
        },
      },
      assignments: {
        orderBy: { id: 'asc' },
        select: { id: true, status: true, expertId: true, isAiInitiated: true },
      },
      disputes: { where: OPEN_DISPUTE_FILTER, orderBy: { id: 'asc' }, select: OPEN_DISPUTE_SELECT },
    },
  });
  if (!project) return null;

  const milestones = await db.milestone.groupBy({
    by: ['status'],
    where: { projectId: project.id },
    _count: { _all: true },
  });

  return {
    ...toProjectSummary(project),
    description: project.description,
    category: project.category ? { categoryId: project.category.id, name: project.category.name } : null,
    deadline: iso(project.deadline),
    activatedAt: iso(project.activatedAt),
    completedAt: iso(project.completedAt),
    closedAt: iso(project.closedAt),
    estimate: {
      effortHours: project.estimatedEffortHours,
      durationDays: project.estimatedDurationDays,
      budgetMinMinor: minor(project.estimatedBudgetMinMinor),
      budgetMaxMinor: minor(project.estimatedBudgetMaxMinor),
      teamSize: project.estimatedTeamSize,
    },
    contracts: project.contracts.map((contract) => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      totalValueMinor: contract.totalValueMinor.toString(),
      currency: contract.currency,
      expertName: contract.expert?.user.fullName ?? null,
    })),
    assignments: project.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      status: assignment.status,
      expertId: assignment.expertId,
      isAiInitiated: assignment.isAiInitiated,
    })),
    milestonesByStatus: milestones.map((group) => ({ status: group.status, count: group._count._all })),
    openDisputes: project.disputes.map(toOpenDispute),
    availableInterventions: availableInterventions('Project', project.status),
  };
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface AdminContractSummary {
  readonly contractId: string;
  readonly contractNumber: string;
  readonly type: string;
  readonly status: string;
  readonly totalValueMinor: string;
  readonly currency: string;
  readonly project: { readonly projectId: string; readonly projectNumber: string; readonly title: string };
  readonly customer: { readonly customerId: string; readonly fullName: string };
  readonly expert: { readonly expertId: string; readonly fullName: string } | null;
  readonly teamId: string | null;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  readonly terminatedAt: string | null;
}

const CONTRACT_SUMMARY_SELECT = {
  id: true,
  contractNumber: true,
  type: true,
  status: true,
  totalValueMinor: true,
  currency: true,
  teamId: true,
  createdAt: true,
  acceptedAt: true,
  terminatedAt: true,
  project: { select: { id: true, projectNumber: true, title: true } },
  customer: { select: { id: true, user: { select: { fullName: true } } } },
  expert: { select: { id: true, user: { select: { fullName: true } } } },
} satisfies Prisma.ContractSelect;

interface ContractSummaryRow {
  readonly id: string;
  readonly contractNumber: string;
  readonly type: string;
  readonly status: string;
  readonly totalValueMinor: bigint;
  readonly currency: string;
  readonly teamId: string | null;
  readonly createdAt: Date;
  readonly acceptedAt: Date | null;
  readonly terminatedAt: Date | null;
  readonly project: { readonly id: string; readonly projectNumber: string; readonly title: string };
  readonly customer: { readonly id: string; readonly user: { readonly fullName: string } };
  readonly expert: { readonly id: string; readonly user: { readonly fullName: string } } | null;
}

function toContractSummary(row: ContractSummaryRow): AdminContractSummary {
  return {
    contractId: row.id,
    contractNumber: row.contractNumber,
    type: row.type,
    status: row.status,
    totalValueMinor: row.totalValueMinor.toString(),
    currency: row.currency,
    project: { projectId: row.project.id, projectNumber: row.project.projectNumber, title: row.project.title },
    customer: { customerId: row.customer.id, fullName: row.customer.user.fullName },
    expert: row.expert ? { expertId: row.expert.id, fullName: row.expert.user.fullName } : null,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: iso(row.acceptedAt),
    terminatedAt: iso(row.terminatedAt),
  };
}

export async function listContracts(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: ContractState | undefined;
    readonly projectId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminContractSummary>> {
  assertCapability(params.actor, 'CONTRACTS_READ');
  const size = pageSize(params.limit);

  const rows = await db.contract.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: CONTRACT_SUMMARY_SELECT,
  });

  return toPage(rows, size, toContractSummary);
}

export interface AdminContractDetail extends AdminContractSummary {
  readonly hourlyRateMinor: string | null;
  readonly weeklyHourLimit: number | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly sentAt: string | null;
  readonly customerSignedAt: string | null;
  readonly expertSignedAt: string | null;
  readonly completedAt: string | null;
  readonly closedAt: string | null;
  readonly terminationReason: string | null;
  readonly versions: readonly {
    readonly versionNumber: number;
    readonly scope: string;
    readonly acceptanceCriteria: string | null;
    readonly totalValueMinor: string;
    readonly isSigned: boolean;
    readonly signedAt: string | null;
    readonly supersededAt: string | null;
    readonly changeReason: string | null;
    readonly createdAt: string;
  }[];
  readonly milestones: readonly {
    readonly milestoneId: string;
    readonly title: string;
    readonly status: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly dueDate: string | null;
    readonly orderIndex: number;
  }[];
  readonly openDisputes: readonly OpenDispute[];
  readonly availableInterventions: readonly string[];
}

export async function getContract(
  params: { readonly actor: Actor; readonly contractId: string },
  db: Db = prisma,
): Promise<AdminContractDetail | null> {
  assertCapability(params.actor, 'CONTRACTS_READ');
  if (!isUuid(params.contractId)) return null;

  const contract = await db.contract.findUnique({
    where: { id: params.contractId },
    select: {
      ...CONTRACT_SUMMARY_SELECT,
      hourlyRateMinor: true,
      weeklyHourLimit: true,
      startDate: true,
      endDate: true,
      sentAt: true,
      customerSignedAt: true,
      expertSignedAt: true,
      completedAt: true,
      closedAt: true,
      terminationReason: true,
      versions: {
        orderBy: { versionNumber: 'asc' },
        select: {
          versionNumber: true,
          scope: true,
          acceptanceCriteria: true,
          totalValueMinor: true,
          isSigned: true,
          signedAt: true,
          supersededAt: true,
          changeReason: true,
          createdAt: true,
        },
      },
      milestones: {
        orderBy: { orderIndex: 'asc' },
        select: { id: true, title: true, status: true, amountMinor: true, currency: true, dueDate: true, orderIndex: true },
      },
      disputes: { where: OPEN_DISPUTE_FILTER, orderBy: { id: 'asc' }, select: OPEN_DISPUTE_SELECT },
    },
  });
  if (!contract) return null;

  return {
    ...toContractSummary(contract),
    hourlyRateMinor: minor(contract.hourlyRateMinor),
    weeklyHourLimit: contract.weeklyHourLimit,
    startDate: iso(contract.startDate),
    endDate: iso(contract.endDate),
    sentAt: iso(contract.sentAt),
    customerSignedAt: iso(contract.customerSignedAt),
    expertSignedAt: iso(contract.expertSignedAt),
    completedAt: iso(contract.completedAt),
    closedAt: iso(contract.closedAt),
    terminationReason: contract.terminationReason,
    versions: contract.versions.map((version) => ({
      versionNumber: version.versionNumber,
      scope: version.scope,
      acceptanceCriteria: version.acceptanceCriteria,
      totalValueMinor: version.totalValueMinor.toString(),
      isSigned: version.isSigned,
      signedAt: iso(version.signedAt),
      supersededAt: iso(version.supersededAt),
      changeReason: version.changeReason,
      createdAt: version.createdAt.toISOString(),
    })),
    milestones: contract.milestones.map((milestone) => ({
      milestoneId: milestone.id,
      title: milestone.title,
      status: milestone.status,
      amountMinor: milestone.amountMinor.toString(),
      currency: milestone.currency,
      dueDate: iso(milestone.dueDate),
      orderIndex: milestone.orderIndex,
    })),
    openDisputes: contract.disputes.map(toOpenDispute),
    availableInterventions: availableInterventions('Contract', contract.status),
  };
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface AdminMilestoneSummary {
  readonly milestoneId: string;
  readonly title: string;
  readonly status: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly orderIndex: number;
  readonly dueDate: string | null;
  readonly revisionCount: number;
  readonly projectId: string;
  readonly contract: { readonly contractId: string; readonly contractNumber: string };
  readonly createdAt: string;
}

const MILESTONE_SUMMARY_SELECT = {
  id: true,
  title: true,
  status: true,
  amountMinor: true,
  currency: true,
  orderIndex: true,
  dueDate: true,
  revisionCount: true,
  projectId: true,
  createdAt: true,
  contract: { select: { id: true, contractNumber: true } },
} satisfies Prisma.MilestoneSelect;

interface MilestoneSummaryRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly orderIndex: number;
  readonly dueDate: Date | null;
  readonly revisionCount: number;
  readonly projectId: string;
  readonly createdAt: Date;
  readonly contract: { readonly id: string; readonly contractNumber: string };
}

function toMilestoneSummary(row: MilestoneSummaryRow): AdminMilestoneSummary {
  return {
    milestoneId: row.id,
    title: row.title,
    status: row.status,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    orderIndex: row.orderIndex,
    dueDate: iso(row.dueDate),
    revisionCount: row.revisionCount,
    projectId: row.projectId,
    contract: { contractId: row.contract.id, contractNumber: row.contract.contractNumber },
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMilestones(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: MilestoneState | undefined;
    readonly projectId?: string | undefined;
    readonly contractId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminMilestoneSummary>> {
  assertCapability(params.actor, 'MILESTONES_READ');
  const size = pageSize(params.limit);

  const rows = await db.milestone.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.contractId ? { contractId: params.contractId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: MILESTONE_SUMMARY_SELECT,
  });

  return toPage(rows, size, toMilestoneSummary);
}

export interface AdminMilestoneDetail extends AdminMilestoneSummary {
  readonly description: string | null;
  readonly acceptanceCriteria: string | null;
  readonly fundedAt: string | null;
  readonly startedAt: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly deliverables: readonly {
    readonly deliverableId: string;
    readonly title: string;
    readonly version: number;
    readonly status: string;
    readonly fileName: string | null;
    readonly externalUrl: string | null;
    readonly reviewedAt: string | null;
    readonly createdAt: string;
  }[];
  readonly openDisputes: readonly OpenDispute[];
  /** Present only for callers who may read payments. */
  readonly payments:
    | readonly {
        readonly paymentId: string;
        readonly status: string;
        readonly amountMinor: string;
        readonly refundedAmountMinor: string;
        readonly currency: string;
      }[]
    | null;
  readonly availableInterventions: readonly string[];
}

export async function getMilestone(
  params: { readonly actor: Actor; readonly milestoneId: string },
  db: Db = prisma,
): Promise<AdminMilestoneDetail | null> {
  assertCapability(params.actor, 'MILESTONES_READ');
  if (!isUuid(params.milestoneId)) return null;

  const milestone = await db.milestone.findUnique({
    where: { id: params.milestoneId },
    select: {
      ...MILESTONE_SUMMARY_SELECT,
      description: true,
      acceptanceCriteria: true,
      fundedAt: true,
      startedAt: true,
      submittedAt: true,
      approvedAt: true,
      deliverables: {
        orderBy: { version: 'asc' },
        select: {
          id: true,
          title: true,
          version: true,
          status: true,
          fileName: true,
          externalUrl: true,
          reviewedAt: true,
          createdAt: true,
        },
      },
      disputes: { where: OPEN_DISPUTE_FILTER, orderBy: { id: 'asc' }, select: OPEN_DISPUTE_SELECT },
    },
  });
  if (!milestone) return null;

  const payments = hasCapability(params.actor, 'PAYMENTS_READ')
    ? (
        await db.payment.findMany({
          where: { order: { milestoneId: milestone.id } },
          orderBy: { id: 'asc' },
          select: { id: true, status: true, amountMinor: true, refundedAmountMinor: true, currency: true },
        })
      ).map((payment) => ({
        paymentId: payment.id,
        status: payment.status,
        amountMinor: payment.amountMinor.toString(),
        refundedAmountMinor: payment.refundedAmountMinor.toString(),
        currency: payment.currency,
      }))
    : null;

  return {
    ...toMilestoneSummary(milestone),
    description: milestone.description,
    acceptanceCriteria: milestone.acceptanceCriteria,
    fundedAt: iso(milestone.fundedAt),
    startedAt: iso(milestone.startedAt),
    submittedAt: iso(milestone.submittedAt),
    approvedAt: iso(milestone.approvedAt),
    deliverables: milestone.deliverables.map((deliverable) => ({
      deliverableId: deliverable.id,
      title: deliverable.title,
      version: deliverable.version,
      status: deliverable.status,
      fileName: deliverable.fileName,
      externalUrl: deliverable.externalUrl,
      reviewedAt: iso(deliverable.reviewedAt),
      createdAt: deliverable.createdAt.toISOString(),
    })),
    openDisputes: milestone.disputes.map(toOpenDispute),
    payments,
    availableInterventions: availableInterventions('Milestone', milestone.status),
  };
}
