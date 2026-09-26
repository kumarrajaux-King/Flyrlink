/**
 * Database fixtures for the Phase 8 admin tests: the lifecycle world, plus the
 * operational roles and the records the admin control plane governs —
 * verification cases, reviews, payouts and categories.
 *
 * Like the lifecycle fixtures, these write rows directly at whatever state a
 * test starts from. Every change a test asserts on goes through the admin
 * services or routes.
 */

import { type RoleName, requiresMfa } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { type Person, createLifecycleWorld } from './lifecycle-fixtures';

type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
type VerificationStatus = 'PENDING' | 'IN_REVIEW' | 'VERIFIED' | 'REJECTED';
type ReviewStatus = 'PENDING' | 'PUBLISHED' | 'FLAGGED' | 'UNDER_MODERATION' | 'REJECTED' | 'HIDDEN';
type PayoutStatus = 'PENDING' | 'PENDING_APPROVAL' | 'APPROVED' | 'ON_HOLD' | 'CANCELLED';

export async function createAdminWorld(label: string) {
  const world = await createLifecycleWorld(label);
  let sequence = 0;
  const unique = (): string => `${world.stamp}-x${(sequence += 1)}`;

  const extra = {
    users: [] as string[],
    verifications: [] as string[],
    reviews: [] as string[],
    payouts: [] as string[],
    categories: [] as string[],
  };

  async function person(
    name: string,
    roles: RoleName[],
    options: {
      status?: AccountStatus;
      emailVerified?: boolean;
      failedLoginCount?: number;
      lockedUntil?: Date | null;
      mfaEnrolled?: boolean;
    } = {},
  ): Promise<Person> {
    const status = options.status ?? 'ACTIVE';
    const user = await prisma.user.create({
      data: {
        email: `${label}-${name}-${unique()}@example.test`,
        fullName: `${label} ${name}`,
        status,
        emailVerified: options.emailVerified === false ? null : new Date(),
        failedLoginCount: options.failedLoginCount ?? 0,
        lockedUntil: options.lockedUntil ?? null,
        // A role in the MFA-required set has to have a second factor enrolled
        // before any session of theirs can count as cleared, so a fixture that
        // wants a working administrator has to enrol one. `options.mfaEnrolled:
        // false` is how a test asks for the administrator who never did.
        mfaEnabled: options.mfaEnrolled ?? requiresMfa(roles),
      },
      select: { id: true },
    });
    extra.users.push(user.id);

    for (const roleName of roles) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName, description: `${roleName} role` },
        select: { id: true },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }

    return {
      name,
      userId: user.id,
      actor: { userId: user.id, roles, mfaSatisfied: true, accountActive: status === 'ACTIVE' },
    };
  }

  async function expertProfileFor(who: Person): Promise<string> {
    const profile = await prisma.expertProfile.create({
      data: { userId: who.userId, slug: `${label}-${who.name}-${unique()}` },
      select: { id: true },
    });
    return profile.id;
  }

  const support = await person('support', ['SUPPORT']);
  const verifier = await person('verifier', ['VERIFICATION_MANAGER']);
  const otherAdmin = await person('other-admin', ['ADMIN']);

  async function newVerification(
    expertProfileId: string,
    options: { status?: VerificationStatus; submittedAt?: Date; reviewedAt?: Date | null; aiFlagCount?: number } = {},
  ): Promise<string> {
    const verification = await prisma.expertVerification.create({
      data: {
        expertId: expertProfileId,
        status: options.status ?? 'PENDING',
        submittedAt: options.submittedAt ?? new Date(),
        reviewedAt: options.reviewedAt ?? null,
        aiFlagCount: options.aiFlagCount ?? 0,
        documentKeys: ['verification/identity.pdf'],
      },
      select: { id: true },
    });
    extra.verifications.push(verification.id);
    return verification.id;
  }

  async function newReview(options: {
    status: ReviewStatus;
    projectId: string;
    contractId: string;
    reviewerUserId?: string;
    revieweeUserId?: string;
    isVerifiedTransaction?: boolean;
  }): Promise<string> {
    const review = await prisma.review.create({
      data: {
        projectId: options.projectId,
        contractId: options.contractId,
        reviewerUserId: options.reviewerUserId ?? world.customer.userId,
        revieweeUserId: options.revieweeUserId ?? world.expert.userId,
        direction: 'CUSTOMER_TO_EXPERT',
        status: options.status,
        overallRating: 4,
        comment: 'Solid delivery, slightly late.',
        isVerifiedTransaction: options.isVerifiedTransaction ?? true,
        publishedAt: options.status === 'PUBLISHED' ? new Date() : null,
      },
      select: { id: true },
    });
    extra.reviews.push(review.id);
    return review.id;
  }

  async function newPayout(options: {
    items: { amountMinor: bigint; milestoneId?: string; contractId?: string; currency?: string }[];
    expertProfileId?: string;
    status?: PayoutStatus;
    grossAmountMinor?: bigint;
  }): Promise<string> {
    const gross = options.grossAmountMinor ?? options.items.reduce((sum, item) => sum + item.amountMinor, 0n);
    const commission = gross / 10n;
    const payout = await prisma.payout.create({
      data: {
        payoutNumber: `AD-PO-${unique()}`,
        expertId: options.expertProfileId ?? world.expertProfileId,
        provider: 'RAZORPAY',
        grossAmountMinor: gross,
        commissionAmountMinor: commission,
        netAmountMinor: gross - commission,
        currency: 'INR',
        status: options.status ?? 'PENDING_APPROVAL',
        idempotencyKey: `ad-po-${unique()}`,
        items: {
          create: options.items.map((item) => ({
            amountMinor: item.amountMinor,
            currency: item.currency ?? 'INR',
            milestoneId: item.milestoneId ?? null,
            contractId: item.contractId ?? null,
          })),
        },
      },
      select: { id: true },
    });
    extra.payouts.push(payout.id);
    return payout.id;
  }

  async function newCategory(options: { name?: string; parentId?: string | null; isActive?: boolean } = {}): Promise<string> {
    const category = await prisma.category.create({
      data: {
        name: options.name ?? `Category ${unique()}`,
        slug: `${label}-category-${unique()}`,
        parentId: options.parentId ?? null,
        isActive: options.isActive ?? true,
      },
      select: { id: true },
    });
    extra.categories.push(category.id);
    return category.id;
  }

  /** Track a category a test created through the service, so cleanup removes it. */
  function trackCategory(id: string): void {
    extra.categories.push(id);
  }

  async function cleanup(): Promise<void> {
    await prisma.payout.deleteMany({ where: { id: { in: extra.payouts } } });
    await prisma.review.deleteMany({ where: { id: { in: extra.reviews } } });
    await prisma.expertVerification.deleteMany({ where: { id: { in: extra.verifications } } });
    // Children before parents: the tree's foreign key restricts deleting a parent.
    for (let pass = 0; pass < 10; pass += 1) {
      const removed = await prisma.category.deleteMany({
        where: { id: { in: extra.categories }, children: { none: {} } },
      });
      if (removed.count === 0) break;
    }

    const entityIds = [...extra.users, ...extra.verifications, ...extra.reviews, ...extra.payouts, ...extra.categories];
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: entityIds } }, { actorUserId: { in: extra.users } }] },
    });

    await world.cleanup();
    await prisma.user.deleteMany({ where: { id: { in: extra.users } } });
  }

  return {
    ...world,
    support,
    verifier,
    otherAdmin,
    person,
    expertProfileFor,
    newVerification,
    newReview,
    newPayout,
    newCategory,
    trackCategory,
    cleanup,
  };
}

export type AdminWorld = Awaited<ReturnType<typeof createAdminWorld>>;
