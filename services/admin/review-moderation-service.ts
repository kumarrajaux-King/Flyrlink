/**
 * Review moderation (Phase 8).
 *
 * Moderators change whether a review is visible — never what it says. There is
 * no path here that edits a rating or a comment, and no path that deletes a
 * review. A moderator may not decide a review they wrote or received.
 *
 * Reputation aggregates (`ExpertPerformance`) are recomputed from source records
 * by the reputation pipeline (Phase 11); hiding a review changes its status here
 * and the aggregate on the next recompute.
 */

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { assertCapability, checkNotParty } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { availableEvents } from '../../domain/lifecycle/machine';
import {
  REVIEW_MODERATION_MACHINE,
  type ReviewModerationContext,
  type ReviewModerationEvent,
  type ReviewState,
} from '../../domain/review/moderation-machine';
import { type GovernedRequest, type GovernedSpec, executeGovernedChange } from './governed-change';
import { type AdminOutcome, precondition } from './outcome';
import { type Page, type PageRequest, iso, newestFirst, pageSize, toPage } from './pagination';

/** What a moderator sees by default: reviews waiting for a decision. */
const MODERATION_QUEUE_STATES = ['FLAGGED', 'UNDER_MODERATION'] as const;

export interface ModerationReview {
  readonly reviewId: string;
  readonly status: string;
  readonly direction: string;
  readonly overallRating: number;
  readonly comment: string | null;
  readonly isVerifiedTransaction: boolean;
  readonly flagCount: number;
  readonly ratings: readonly { readonly dimension: string; readonly score: number }[];
  readonly projectId: string;
  readonly contractId: string;
  readonly reviewer: { readonly userId: string; readonly fullName: string };
  readonly reviewee: { readonly userId: string; readonly fullName: string };
  readonly moderatedBy: { readonly userId: string; readonly fullName: string } | null;
  readonly moderatedAt: string | null;
  readonly moderationNotes: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly availableEvents: readonly ReviewModerationEvent[];
}

export async function listReviewsForModeration(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: ReviewState | undefined;
    readonly revieweeUserId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<ModerationReview>> {
  assertCapability(params.actor, 'REVIEWS_MODERATE');
  const size = pageSize(params.limit);

  const rows = await db.review.findMany({
    where: {
      deletedAt: null,
      status: params.status ?? { in: [...MODERATION_QUEUE_STATES] },
      ...(params.revieweeUserId ? { revieweeUserId: params.revieweeUserId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      status: true,
      direction: true,
      overallRating: true,
      comment: true,
      isVerifiedTransaction: true,
      flagCount: true,
      projectId: true,
      contractId: true,
      moderatedAt: true,
      moderationNotes: true,
      publishedAt: true,
      createdAt: true,
      ratings: { select: { dimension: true, score: true } },
      reviewer: { select: { id: true, fullName: true } },
      reviewee: { select: { id: true, fullName: true } },
      moderatedBy: { select: { id: true, fullName: true } },
    },
  });

  return toPage(rows, size, (row) => ({
    reviewId: row.id,
    status: row.status,
    direction: row.direction,
    overallRating: row.overallRating,
    comment: row.comment,
    isVerifiedTransaction: row.isVerifiedTransaction,
    flagCount: row.flagCount,
    ratings: row.ratings,
    projectId: row.projectId,
    contractId: row.contractId,
    reviewer: { userId: row.reviewer.id, fullName: row.reviewer.fullName },
    reviewee: { userId: row.reviewee.id, fullName: row.reviewee.fullName },
    moderatedBy: row.moderatedBy ? { userId: row.moderatedBy.id, fullName: row.moderatedBy.fullName } : null,
    moderatedAt: iso(row.moderatedAt),
    moderationNotes: row.moderationNotes,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    availableEvents: availableEvents(REVIEW_MODERATION_MACHINE, row.status, 'HUMAN', {}),
  }));
}

interface ReviewRow {
  readonly id: string;
  readonly status: ReviewState;
  readonly reviewerUserId: string;
  readonly revieweeUserId: string;
  readonly isVerifiedTransaction: boolean;
  readonly publishedAt: Date | null;
}

const REVIEW_SPEC: GovernedSpec<ReviewState, ReviewModerationEvent, ReviewModerationContext, ReviewRow, null> = {
  entityType: 'Review',
  table: 'reviews',
  machine: REVIEW_MODERATION_MACHINE,
  auditAction: AUDIT_ACTIONS.ADMIN_REVIEW_TRANSITIONED,

  load: (tx, id) =>
    tx.review.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        reviewerUserId: true,
        revieweeUserId: true,
        isVerifiedTransaction: true,
        publishedAt: true,
      },
    }),

  status: (row) => row.status,

  context: () => ({}),

  guard: async (_tx, row, _event, actor) => checkNotParty(actor, [row.reviewerUserId, row.revieweeUserId]),

  async prepare({ entity, event }) {
    if ((event === 'PUBLISH' || event === 'REINSTATE') && !entity.isVerifiedTransaction) {
      throw precondition('Only a review of a verified transaction can be published.');
    }
    return null;
  },

  async write({ tx, entity, from, to, request, reason, now }) {
    const result = await tx.review.updateMany({
      where: { id: entity.id, status: from },
      data: {
        status: to,
        moderatedByUserId: request.actor.userId,
        moderatedAt: now,
        ...(reason ? { moderationNotes: reason } : {}),
        ...(to === 'PUBLISHED' && entity.publishedAt === null ? { publishedAt: now } : {}),
      },
    });
    return result.count;
  },

  effects: async ({ entity }) => ({ revieweeUserId: entity.revieweeUserId }),
};

/** Take a review into moderation, publish, hide, reinstate or reject it. */
export function moderateReview(request: GovernedRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeGovernedChange(REVIEW_SPEC, request, db);
}
