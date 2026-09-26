/**
 * Database fixtures for the lifecycle integration and route tests.
 *
 * Fixtures write rows directly, at whatever state a test starts from — the same
 * way `prisma/seed.ts` does. That is setup, not a transition: every state change
 * a test asserts on goes through the lifecycle services or the HTTP routes.
 *
 * Each world gets a unique stamp, and `cleanup()` removes everything it made in
 * foreign-key order, so suites can share the development database.
 */

import type { Actor } from '../../lib/authz/authorize';
import { type RoleName, requiresMfa } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { SESSION_COOKIE_NAME } from '../../lib/http/session-cookie';
import { createSession } from '../../services/auth/session-service';
import type { ContractState } from '../../domain/contract/state-machine';
import type { MilestoneState } from '../../domain/milestone/state-machine';
import type { PaymentState } from '../../domain/payment/state-machine';
import type { ProjectSource, ProjectState } from '../../domain/project/state-machine';

export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export interface Person {
  readonly name: string;
  readonly userId: string;
  readonly actor: Actor;
}

export type AssignmentState =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'INVITED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Engagement {
  readonly projectId: string;
  readonly contractId: string;
  readonly milestoneId: string;
  readonly paymentId: string;
}

export async function createLifecycleWorld(label: string) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let sequence = 0;
  const unique = (): string => `${stamp}-${(sequence += 1)}`;

  const tracked = {
    users: [] as string[],
    projects: [] as string[],
    contracts: [] as string[],
    milestones: [] as string[],
    payments: [] as string[],
    orders: [] as string[],
    webhooks: [] as string[],
    runs: [] as string[],
  };

  async function person(name: string, roles: RoleName[]): Promise<Person> {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${name}-${stamp}@example.test`,
        fullName: `${label} ${name}`,
        status: 'ACTIVE',
        emailVerified: new Date(),
        // A privileged role needs an enrolled second factor before any session
        // of theirs counts as MFA-cleared.
        mfaEnabled: requiresMfa(roles),
      },
      select: { id: true },
    });
    tracked.users.push(user.id);

    // Role rows matter for route tests: a session's actor is built from them.
    for (const roleName of roles) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName, description: `${roleName} role` },
        select: { id: true },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }

    return { name, userId: user.id, actor: { userId: user.id, roles, mfaSatisfied: true, accountActive: true } };
  }

  const customer = await person('customer', ['CUSTOMER']);
  const otherCustomer = await person('other-customer', ['CUSTOMER']);
  const expert = await person('expert', ['EXPERT']);
  const otherExpert = await person('other-expert', ['EXPERT']);
  const admin = await person('admin', ['ADMIN']);
  const finance = await person('finance', ['FINANCE']);
  const superAdmin = await person('super-admin', ['SUPER_ADMIN']);

  const customerProfileId = (
    await prisma.customerProfile.create({ data: { userId: customer.userId }, select: { id: true } })
  ).id;
  const otherCustomerProfileId = (
    await prisma.customerProfile.create({ data: { userId: otherCustomer.userId }, select: { id: true } })
  ).id;
  const expertProfileId = (
    await prisma.expertProfile.create({
      data: { userId: expert.userId, slug: `${label}-expert-${stamp}` },
      select: { id: true },
    })
  ).id;
  const otherExpertProfileId = (
    await prisma.expertProfile.create({
      data: { userId: otherExpert.userId, slug: `${label}-other-expert-${stamp}` },
      select: { id: true },
    })
  ).id;

  async function newProject(
    options: { source?: ProjectSource; status?: ProjectState; customerProfileId?: string } = {},
  ): Promise<string> {
    const source = options.source ?? 'POSTED_PROJECT';
    const project = await prisma.project.create({
      data: {
        projectNumber: `LC-P-${unique()}`,
        customerId: options.customerProfileId ?? customerProfileId,
        source,
        status: options.status ?? 'DRAFT',
        title: 'Lifecycle test project',
        description: 'Exercises the Phase 6 state machines.',
        currency: 'INR',
        invitedExpertId: source === 'DIRECT_HIRE' ? expertProfileId : null,
      },
      select: { id: true },
    });
    tracked.projects.push(project.id);
    return project.id;
  }

  async function newContract(
    projectId: string,
    options: { status?: ContractState; version?: 'unsigned' | 'signed' | 'none' } = {},
  ): Promise<string> {
    const status = options.status ?? 'DRAFT';
    const contract = await prisma.contract.create({
      data: {
        projectId,
        customerId: customerProfileId,
        expertId: expertProfileId,
        contractNumber: `LC-C-${unique()}`,
        type: 'FIXED_PRICE',
        status,
        totalValueMinor: 100_000n,
        currency: 'INR',
      },
      select: { id: true },
    });
    tracked.contracts.push(contract.id);

    const version = options.version ?? (['DRAFT', 'SENT', 'NEGOTIATION'].includes(status) ? 'unsigned' : 'signed');
    if (version !== 'none') {
      await prisma.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNumber: 1,
          scope: 'Deliver the agreed scope.',
          terms: { paymentTerms: 'per milestone' },
          totalValueMinor: 100_000n,
          currency: 'INR',
          isSigned: version === 'signed',
          signedAt: version === 'signed' ? new Date() : null,
        },
      });
    }
    return contract.id;
  }

  async function newMilestone(
    contractId: string,
    projectId: string,
    options: { status?: MilestoneState; amountMinor?: bigint } = {},
  ): Promise<string> {
    const orderIndex = await prisma.milestone.count({ where: { contractId } });
    const milestone = await prisma.milestone.create({
      data: {
        contractId,
        projectId,
        title: `Milestone ${orderIndex + 1}`,
        amountMinor: options.amountMinor ?? 50_000n,
        currency: 'INR',
        status: options.status ?? 'DRAFT',
        orderIndex,
      },
      select: { id: true },
    });
    tracked.milestones.push(milestone.id);
    return milestone.id;
  }

  async function newWebhook(
    options: { verified?: boolean; provider?: 'RAZORPAY' | 'STRIPE' } = {},
  ): Promise<string> {
    const event = await prisma.webhookEvent.create({
      data: {
        provider: options.provider ?? 'RAZORPAY',
        providerEventId: `evt_${unique()}`,
        eventType: 'payment.event',
        signatureVerified: options.verified ?? true,
        payload: { fixture: true },
      },
      select: { id: true },
    });
    tracked.webhooks.push(event.id);
    return event.id;
  }

  async function newPayment(
    links: { projectId: string; contractId: string; milestoneId: string },
    options: {
      status?: PaymentState;
      amountMinor?: bigint;
      provider?: 'RAZORPAY' | 'STRIPE';
      confirmedByWebhookEventId?: string | null;
    } = {},
  ): Promise<string> {
    const amount = options.amountMinor ?? 50_000n;
    const order = await prisma.order.create({
      data: {
        orderNumber: `LC-O-${unique()}`,
        customerId: customerProfileId,
        projectId: links.projectId,
        contractId: links.contractId,
        milestoneId: links.milestoneId,
        type: 'MILESTONE_FUNDING',
        subtotalMinor: amount,
        totalMinor: amount,
        currency: 'INR',
      },
      select: { id: true },
    });
    tracked.orders.push(order.id);

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: customerProfileId,
        provider: options.provider ?? 'RAZORPAY',
        amountMinor: amount,
        currency: 'INR',
        status: options.status ?? 'CREATED',
        idempotencyKey: `lc-${unique()}`,
        confirmedByWebhookEventId: options.confirmedByWebhookEventId ?? null,
      },
      select: { id: true },
    });
    tracked.payments.push(payment.id);
    return payment.id;
  }

  async function newAssignment(projectId: string, status: AssignmentState, expertId = expertProfileId): Promise<string> {
    const assignment = await prisma.assignment.create({
      data: { projectId, expertId, status, ...(status === 'INVITED' ? { invitedAt: new Date() } : {}) },
      select: { id: true },
    });
    return assignment.id;
  }

  async function newDeliverable(milestoneId: string): Promise<void> {
    const version = (await prisma.deliverable.count({ where: { milestoneId } })) + 1;
    await prisma.deliverable.create({
      data: { milestoneId, submittedByExpertId: expertProfileId, title: `Deliverable v${version}`, version },
    });
  }

  /**
   * A live engagement: an ACTIVE project and contract, a milestone, and the
   * webhook-confirmed payment that funds it.
   */
  async function engagement(
    options: {
      projectStatus?: ProjectState;
      contractStatus?: ContractState;
      milestoneStatus?: MilestoneState;
      paymentStatus?: PaymentState;
    } = {},
  ): Promise<Engagement> {
    const projectId = await newProject({ status: options.projectStatus ?? 'ACTIVE' });
    const contractId = await newContract(projectId, { status: options.contractStatus ?? 'ACTIVE' });
    const milestoneId = await newMilestone(contractId, projectId, { status: options.milestoneStatus ?? 'IN_PROGRESS' });
    const paymentId = await newPayment(
      { projectId, contractId, milestoneId },
      { status: options.paymentStatus ?? 'FUNDS_ALLOCATED', confirmedByWebhookEventId: await newWebhook() },
    );
    return { projectId, contractId, milestoneId, paymentId };
  }

  async function sessionCookie(who: Person, options: { mfa?: boolean } = {}): Promise<string> {
    const session = await createSession(prisma, { userId: who.userId, mfaSatisfied: options.mfa ?? true });
    return `${SESSION_COOKIE_NAME}=${session.rawToken}`;
  }

  async function cleanup(): Promise<void> {
    const entityIds = [
      ...tracked.projects,
      ...tracked.contracts,
      ...tracked.milestones,
      ...tracked.payments,
      ...tracked.users,
    ];
    await prisma.dispute.deleteMany({ where: { projectId: { in: tracked.projects } } });
    await prisma.payment.deleteMany({ where: { id: { in: tracked.payments } } });
    await prisma.order.deleteMany({ where: { id: { in: tracked.orders } } });
    // Deleting contracts cascades to their versions, milestones and deliverables.
    await prisma.contract.deleteMany({ where: { projectId: { in: tracked.projects } } });
    await prisma.aiRun.deleteMany({
      where: { OR: [{ projectId: { in: tracked.projects } }, { id: { in: tracked.runs } }] },
    });
    // Deleting projects cascades to their assignments.
    await prisma.project.deleteMany({ where: { id: { in: tracked.projects } } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: tracked.webhooks } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: entityIds } }, { actorUserId: { in: tracked.users } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: tracked.users } } });
  }

  return {
    stamp,
    tracked,
    customer,
    otherCustomer,
    expert,
    otherExpert,
    admin,
    finance,
    superAdmin,
    customerProfileId,
    otherCustomerProfileId,
    expertProfileId,
    otherExpertProfileId,
    newProject,
    newContract,
    newMilestone,
    newWebhook,
    newPayment,
    newAssignment,
    newDeliverable,
    engagement,
    sessionCookie,
    cleanup,
  };
}

export type LifecycleWorld = Awaited<ReturnType<typeof createLifecycleWorld>>;

/** A person's actor with some fields changed — an unverified MFA session, a suspended account. */
export function withActor(who: Person, overrides: Partial<Actor>): Person {
  return { ...who, actor: { ...who.actor, ...overrides } };
}

export async function statusOf(
  entity: 'project' | 'contract' | 'milestone' | 'payment',
  id: string,
): Promise<string> {
  const select = { status: true } as const;
  switch (entity) {
    case 'project':
      return (await prisma.project.findUniqueOrThrow({ where: { id }, select })).status;
    case 'contract':
      return (await prisma.contract.findUniqueOrThrow({ where: { id }, select })).status;
    case 'milestone':
      return (await prisma.milestone.findUniqueOrThrow({ where: { id }, select })).status;
    default:
      return (await prisma.payment.findUniqueOrThrow({ where: { id }, select })).status;
  }
}

/** Audit entries for one entity, oldest first. */
export async function auditEntries(entityId: string, action: string | readonly string[]) {
  const actions = typeof action === 'string' ? [action] : [...action];
  return prisma.auditLog.findMany({
    where: { entityId, action: { in: actions } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      action: true,
      actorType: true,
      actorUserId: true,
      actorAiRunId: true,
      severity: true,
      beforeState: true,
      afterState: true,
      requestId: true,
    },
  });
}

/** Read a JSON audit state as a plain record. */
export function stateOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
