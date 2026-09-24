/**
 * Expert verification administration (Phase 8): the queue, the evidence, and
 * the human decision.
 *
 * Only VERIFICATION_MANAGER and SUPER_ADMIN hold `expert:verify:any`. ADMIN
 * does not: operating the platform is not the same authority as vouching for an
 * expert. A reviewer can never decide their own verification, and the only path
 * to VERIFIED is a human APPROVE (blueprint rule 6).
 *
 * The expert profile's `verificationStatus` — what the marketplace shows — is
 * kept in step with the decision in the same transaction. A later case can
 * never quietly downgrade a profile that is currently VERIFIED: withdrawing the
 * badge is an explicit REVOKE.
 */

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { assertCapability } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { Prisma } from '../../src/generated/prisma/client';
import { availableEvents } from '../../domain/lifecycle/machine';
import {
  VERIFICATION_MACHINE,
  type VerificationContext,
  type VerificationEvent,
  type VerificationStage,
  type VerificationState,
  verificationStage,
} from '../../domain/verification/state-machine';
import { type GovernedRequest, type GovernedSpec, executeGovernedChange } from './governed-change';
import { type HistoryEntry, auditHistory } from './history';
import { type AdminOutcome, isUuid, precondition } from './outcome';
import { type Page, type PageRequest, iso, oldestFirst, pageSize, toPage } from './pagination';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface VerificationSummary {
  readonly verificationId: string;
  readonly stage: VerificationStage;
  readonly status: string;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedById: string | null;
  readonly aiFlagCount: number;
  readonly documentCount: number;
  readonly expert: {
    readonly expertId: string;
    readonly slug: string;
    readonly fullName: string;
    readonly headline: string | null;
    readonly profileStatus: string;
  };
}

const SUMMARY_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedById: true,
  aiFlagCount: true,
  documentKeys: true,
  expert: {
    select: { id: true, slug: true, headline: true, verificationStatus: true, user: { select: { fullName: true } } },
  },
} satisfies Prisma.ExpertVerificationSelect;

interface SummaryRow {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewedById: string | null;
  readonly aiFlagCount: number;
  readonly documentKeys: readonly string[];
  readonly expert: {
    readonly id: string;
    readonly slug: string;
    readonly headline: string | null;
    readonly verificationStatus: string;
    readonly user: { readonly fullName: string };
  };
}

function toSummary(row: SummaryRow): VerificationSummary {
  return {
    verificationId: row.id,
    stage: verificationStage(row),
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    reviewedById: row.reviewedById,
    aiFlagCount: row.aiFlagCount,
    documentCount: row.documentKeys.length,
    expert: {
      expertId: row.expert.id,
      slug: row.expert.slug,
      fullName: row.expert.user.fullName,
      headline: row.expert.headline,
      profileStatus: row.expert.verificationStatus,
    },
  };
}

/** The database form of `verificationStage`, so the queue is filtered and paged in SQL. */
function stageFilter(stage: VerificationStage | undefined): Prisma.ExpertVerificationWhereInput {
  const submittedAt = prisma.expertVerification.fields.submittedAt;
  const awaitingReview: Prisma.ExpertVerificationWhereInput = {
    status: 'PENDING',
    OR: [{ reviewedAt: null }, { reviewedAt: { lt: submittedAt } }],
  };

  switch (stage) {
    case 'AWAITING_REVIEW':
      return awaitingReview;
    case 'AWAITING_EXPERT':
      return { status: 'PENDING', reviewedAt: { gte: submittedAt } };
    case 'IN_REVIEW':
      return { status: 'IN_REVIEW' };
    case 'DECIDED':
      return { status: { notIn: ['PENDING', 'IN_REVIEW'] } };
    default:
      // The working queue: everything a reviewer can act on now.
      return { OR: [{ status: 'IN_REVIEW' }, awaitingReview] };
  }
}

/** Oldest first, so the longest-waiting expert is at the top. */
export async function listVerificationQueue(
  params: PageRequest & { readonly actor: Actor; readonly stage?: VerificationStage | undefined },
  db: Db = prisma,
): Promise<Page<VerificationSummary>> {
  assertCapability(params.actor, 'VERIFICATIONS_READ');
  const size = pageSize(params.limit);

  const rows = await db.expertVerification.findMany({
    where: { AND: [stageFilter(params.stage), oldestFirst(params.cursor)] },
    orderBy: { id: 'asc' },
    take: size + 1,
    select: SUMMARY_SELECT,
  });

  return toPage(rows, size, toSummary);
}

// ---------------------------------------------------------------------------
// Case detail — the evidence
// ---------------------------------------------------------------------------

export interface VerificationDetail extends VerificationSummary {
  readonly decisionNotes: string | null;
  readonly aiRunId: string | null;
  /** The Verification Agent's findings. Advisory: they inform, never decide. */
  readonly aiFindings: unknown;
  /** Storage keys of the submitted documents. */
  readonly documentKeys: readonly string[];
  readonly evidence: {
    readonly userId: string;
    readonly accountStatus: string;
    readonly emailVerified: boolean;
    readonly yearsOfExperience: number;
    readonly bio: string | null;
    readonly skills: readonly { readonly name: string; readonly proficiency: string; readonly yearsOfExperience: number }[];
    readonly certifications: readonly {
      readonly name: string;
      readonly issuingOrganization: string;
      readonly credentialId: string | null;
      readonly credentialUrl: string | null;
      readonly issueDate: string | null;
      readonly expiryDate: string | null;
      readonly verificationStatus: string;
    }[];
    readonly portfolio: readonly { readonly title: string; readonly projectUrl: string | null; readonly completedAt: string | null }[];
  };
  readonly previousCases: readonly { readonly verificationId: string; readonly status: string; readonly submittedAt: string }[];
  readonly history: readonly HistoryEntry[];
  readonly availableEvents: readonly VerificationEvent[];
}

export async function getVerification(
  params: { readonly actor: Actor; readonly verificationId: string },
  db: Db = prisma,
): Promise<VerificationDetail | null> {
  assertCapability(params.actor, 'VERIFICATIONS_READ');
  if (!isUuid(params.verificationId)) return null;

  const row = await db.expertVerification.findUnique({
    where: { id: params.verificationId },
    select: {
      ...SUMMARY_SELECT,
      decisionNotes: true,
      aiRunId: true,
      aiFindings: true,
      expert: {
        select: {
          id: true,
          slug: true,
          headline: true,
          verificationStatus: true,
          yearsOfExperience: true,
          bio: true,
          user: { select: { id: true, fullName: true, status: true, emailVerified: true } },
          skills: { select: { proficiency: true, yearsOfExperience: true, skill: { select: { name: true } } } },
          certifications: {
            select: {
              name: true,
              issuingOrganization: true,
              credentialId: true,
              credentialUrl: true,
              issueDate: true,
              expiryDate: true,
              verificationStatus: true,
            },
          },
          portfolioItems: { orderBy: { orderIndex: 'asc' }, select: { title: true, projectUrl: true, completedAt: true } },
          verifications: {
            where: { id: { not: params.verificationId } },
            orderBy: { id: 'desc' },
            take: 10,
            select: { id: true, status: true, submittedAt: true },
          },
        },
      },
    },
  });
  if (!row) return null;

  const stage = verificationStage(row);
  const history = await auditHistory(db, 'ExpertVerification', row.id, [AUDIT_ACTIONS.ADMIN_VERIFICATION_TRANSITIONED]);
  const structural = availableEvents(VERIFICATION_MACHINE, row.status as VerificationState, 'HUMAN', {});

  return {
    ...toSummary(row),
    decisionNotes: row.decisionNotes,
    aiRunId: row.aiRunId,
    aiFindings: row.aiFindings,
    documentKeys: row.documentKeys,
    evidence: {
      userId: row.expert.user.id,
      accountStatus: row.expert.user.status,
      emailVerified: row.expert.user.emailVerified !== null,
      yearsOfExperience: row.expert.yearsOfExperience,
      bio: row.expert.bio,
      skills: row.expert.skills.map((entry) => ({
        name: entry.skill.name,
        proficiency: entry.proficiency,
        yearsOfExperience: entry.yearsOfExperience,
      })),
      certifications: row.expert.certifications.map((certification) => ({
        name: certification.name,
        issuingOrganization: certification.issuingOrganization,
        credentialId: certification.credentialId,
        credentialUrl: certification.credentialUrl,
        issueDate: iso(certification.issueDate),
        expiryDate: iso(certification.expiryDate),
        verificationStatus: certification.verificationStatus,
      })),
      portfolio: row.expert.portfolioItems.map((item) => ({
        title: item.title,
        projectUrl: item.projectUrl,
        completedAt: iso(item.completedAt),
      })),
    },
    previousCases: row.expert.verifications.map((previous) => ({
      verificationId: previous.id,
      status: previous.status,
      submittedAt: previous.submittedAt.toISOString(),
    })),
    history,
    // A case awaiting the expert cannot be taken into review until they respond.
    availableEvents: structural.filter((event) => !(event === 'START_REVIEW' && stage === 'AWAITING_EXPERT')),
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

interface VerificationRow {
  readonly id: string;
  readonly status: VerificationState;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
  readonly aiFlagCount: number;
  readonly expert: {
    readonly id: string;
    readonly userId: string;
    readonly verificationStatus: string;
    readonly user: { readonly status: string };
  };
}

const VERIFICATION_SPEC: GovernedSpec<
  VerificationState,
  VerificationEvent,
  VerificationContext,
  VerificationRow,
  null
> = {
  entityType: 'ExpertVerification',
  table: 'expert_verifications',
  machine: VERIFICATION_MACHINE,
  auditAction: AUDIT_ACTIONS.ADMIN_VERIFICATION_TRANSITIONED,

  load: (tx, id) =>
    tx.expertVerification.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        aiFlagCount: true,
        expert: { select: { id: true, userId: true, verificationStatus: true, user: { select: { status: true } } } },
      },
    }),

  status: (row) => row.status,

  context: () => ({}),

  // Nobody vouches for themselves, whatever their role.
  guard: async (_tx, row, _event, actor) => (row.expert.userId === actor.userId ? 'SELF_ACTION' : null),

  // PENDING is both "never reviewed" and "information requested". Only the
  // second is a repeat of REQUEST_INFORMATION.
  isRepeat: (row, event) => event !== 'REQUEST_INFORMATION' || verificationStage(row) === 'AWAITING_EXPERT',

  async prepare({ entity, event, request }) {
    if (event === 'START_REVIEW' && verificationStage(entity) === 'AWAITING_EXPERT') {
      throw precondition('This case is waiting for the expert to provide the information that was requested.');
    }
    if (event === 'APPROVE') {
      if (entity.aiFlagCount > 0 && request.params?.acknowledgeAiFlags !== true) {
        throw precondition(
          `The Verification Agent raised ${entity.aiFlagCount} flag(s) on this case. Review them, then send ` +
            '"params": { "acknowledgeAiFlags": true } to approve.',
        );
      }
      if (entity.expert.user.status !== 'ACTIVE') {
        throw precondition('The expert’s account is not active, so it cannot be verified.');
      }
    }
    return null;
  },

  async write({ tx, entity, event, from, to, request, reason, now }) {
    const result = await tx.expertVerification.updateMany({
      where: { id: entity.id, status: from },
      data:
        event === 'START_REVIEW'
          ? { status: to, reviewedById: request.actor.userId }
          : { status: to, reviewedById: request.actor.userId, reviewedAt: now, decisionNotes: reason },
    });
    return result.count;
  },

  async effects({ tx, entity, event, request, now }) {
    const profile = entity.expert;
    const currentlyVerified = profile.verificationStatus === 'VERIFIED';
    let profileStatus = profile.verificationStatus;

    switch (event) {
      case 'APPROVE':
        profileStatus = 'VERIFIED';
        await tx.expertProfile.update({
          where: { id: profile.id },
          data: { verificationStatus: 'VERIFIED', verifiedAt: now, verifiedById: request.actor.userId },
        });
        break;
      case 'REVOKE':
        if (currentlyVerified) {
          profileStatus = 'REVOKED';
          await tx.expertProfile.update({
            where: { id: profile.id },
            data: { verificationStatus: 'REVOKED', verifiedAt: null, verifiedById: null },
          });
        }
        break;
      default: {
        // START_REVIEW, REQUEST_INFORMATION, REJECT mirror onto a profile that
        // is not currently verified; a verified profile keeps its badge.
        const mirrored = event === 'START_REVIEW' ? 'IN_REVIEW' : event === 'REQUEST_INFORMATION' ? 'PENDING' : 'REJECTED';
        if (!currentlyVerified) {
          profileStatus = mirrored;
          await tx.expertProfile.update({ where: { id: profile.id }, data: { verificationStatus: mirrored } });
        }
      }
    }

    return {
      expertProfileId: profile.id,
      profileStatus,
      ...(event === 'APPROVE' && entity.aiFlagCount > 0 ? { aiFlagsAcknowledged: entity.aiFlagCount } : {}),
    };
  },
};

/** Take a verification case into review, request information, approve, reject or revoke. */
export function transitionVerification(request: GovernedRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeGovernedChange(VERIFICATION_SPEC, request, db);
}
