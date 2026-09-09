/**
 * Development seed — FAKE DATA ONLY.
 *
 * Seeds one coherent pass through the whole product spine so that every
 * relationship, state machine and financial path has a working example:
 *
 *   Project → Requirements → AI run → Recommendation → Assignment → Contract
 *     → Milestones → Tasks → Deliverable → Order → Payment (webhook-confirmed)
 *     → Transactions → balanced Ledger → Commission → Payout → Review
 *
 * SAFETY
 *   - Refuses to run unless NODE_ENV is development/test.
 *   - Truncates every table first: destructive by design, dev-only.
 *   - Contains no real credentials. Password hashes are obvious placeholders;
 *     no seeded user can authenticate until Phase 4 sets real hashes.
 */

import { existsSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';

import { applyBasisPoints, money, subtract } from '../domain/money/money.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
if (NODE_ENV !== 'development' && NODE_ENV !== 'test') {
  throw new Error(
    `Refusing to seed: NODE_ENV is "${NODE_ENV}". The seed truncates all tables and is development-only.`,
  );
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Clearly-fake placeholder. Real Argon2id hashing arrives in Phase 4 (Auth). */
const DEV_PASSWORD_PLACEHOLDER = 'DEV_SEED_PLACEHOLDER_NOT_A_VALID_HASH';

const INR = 'INR';

async function truncateAll(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`  truncated ${tables.length} tables`);
}

async function main(): Promise<void> {
  console.log('Seeding development data...');
  console.log('- resetting');
  await truncateAll();

  // ---------------------------------------------------------------- IDENTITY
  console.log('- roles & users');
  const roleNames = [
    'CUSTOMER',
    'EXPERT',
    'ADMIN',
    'SUPER_ADMIN',
    'SUPPORT',
    'FINANCE',
    'VERIFICATION_MANAGER',
  ] as const;

  const roles = new Map<string, string>();
  for (const name of roleNames) {
    const role = await prisma.role.create({
      data: {
        name,
        description: `${name} role`,
        isPrivileged: name !== 'CUSTOMER' && name !== 'EXPERT',
      },
    });
    roles.set(name, role.id);
  }

  const makeUser = async (
    email: string,
    fullName: string,
    roleName: (typeof roleNames)[number],
    mfaEnabled = false,
  ) => {
    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash: DEV_PASSWORD_PLACEHOLDER,
        emailVerified: new Date(),
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        mfaEnabled,
        roles: { create: { roleId: roles.get(roleName)! } },
      },
    });
    return user;
  };

  // Privileged staff have MFA enabled (STEP 02 §13).
  const superAdmin = await makeUser('superadmin@example.test', 'Ada Superadmin', 'SUPER_ADMIN', true);
  const admin = await makeUser('admin@example.test', 'Ravi Admin', 'ADMIN', true);
  const finance = await makeUser('finance@example.test', 'Meera Finance', 'FINANCE', true);
  const verifier = await makeUser('verifier@example.test', 'Sam Verifier', 'VERIFICATION_MANAGER', true);
  await makeUser('support@example.test', 'Priya Support', 'SUPPORT', true);

  const customerUser = await makeUser('customer@example.test', 'Nina Customer', 'CUSTOMER');
  const expertUser = await makeUser('expert@example.test', 'Arjun Expert', 'EXPERT');
  const expertUser2 = await makeUser('designer@example.test', 'Leo Designer', 'EXPERT');

  const customer = await prisma.customerProfile.create({
    data: {
      userId: customerUser.id,
      companyName: 'Northwind Retail (demo)',
      industry: 'E-commerce',
      companySize: '51-200',
      billingCountry: 'IN',
      defaultCurrency: INR,
    },
  });

  // ---------------------------------------------------------------- TAXONOMY
  console.log('- categories & skills');
  const engineering = await prisma.category.create({
    data: { name: 'Engineering', slug: 'engineering' },
  });
  const design = await prisma.category.create({ data: { name: 'Design', slug: 'design' } });
  const webDev = await prisma.category.create({
    data: { name: 'Web Development', slug: 'web-development', parentId: engineering.id },
  });

  const skillSpecs = [
    { name: 'TypeScript', slug: 'typescript', categoryId: webDev.id },
    { name: 'React', slug: 'react', categoryId: webDev.id },
    { name: 'Node.js', slug: 'nodejs', categoryId: webDev.id },
    { name: 'PostgreSQL', slug: 'postgresql', categoryId: engineering.id },
    { name: 'UI/UX Design', slug: 'ui-ux-design', categoryId: design.id },
  ];
  const skills = new Map<string, string>();
  for (const spec of skillSpecs) {
    const skill = await prisma.skill.create({ data: spec });
    skills.set(spec.slug, skill.id);
  }

  // ----------------------------------------------------------------- EXPERTS
  console.log('- expert profiles');
  const expert = await prisma.expertProfile.create({
    data: {
      userId: expertUser.id,
      slug: 'arjun-expert',
      headline: 'Full-stack engineer — commerce platforms',
      bio: 'Demo expert profile for development.',
      yearsOfExperience: 8,
      hourlyRateMinor: 350_000n, // ₹3,500.00/hr
      currency: INR,
      availabilityStatus: 'AVAILABLE',
      weeklyCapacityHours: 30,
      timezone: 'Asia/Kolkata',
      isAcceptingWork: true,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedById: verifier.id,
      profileCompleteness: 92,
      skills: {
        create: [
          { skillId: skills.get('typescript')!, proficiency: 'EXPERT', yearsOfExperience: 7, isPrimary: true },
          { skillId: skills.get('react')!, proficiency: 'EXPERT', yearsOfExperience: 6 },
          { skillId: skills.get('nodejs')!, proficiency: 'ADVANCED', yearsOfExperience: 8 },
          { skillId: skills.get('postgresql')!, proficiency: 'ADVANCED', yearsOfExperience: 5 },
        ],
      },
      certifications: {
        create: [
          {
            name: 'AWS Certified Solutions Architect (demo)',
            issuingOrganization: 'Demo Certifier',
            issueDate: new Date('2024-03-01'),
            verificationStatus: 'VERIFIED',
          },
        ],
      },
      portfolioItems: {
        create: [
          {
            title: 'Headless commerce replatform (demo)',
            description: 'Sample portfolio item for development.',
            completedAt: new Date('2025-06-30'),
            imageKeys: ['dev/portfolio/sample-1.png'],
          },
        ],
      },
      availability: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startMinute: 9 * 60,
          endMinute: 18 * 60,
          timezone: 'Asia/Kolkata',
        })),
      },
      performance: {
        create: {
          onTimeDeliveryRate: 9600, // basis points = 96.00%
          revisionRate: 1200,
          cancellationRate: 0,
          disputeRate: 0,
          repeatClientRate: 4000,
          clientSatisfaction: 9400,
          avgResponseMinutes: 45,
          completedProjects: 17,
          totalEarnedMinor: 145_000_000n,
          currency: INR,
          avgRating: 480, // 4.80 stored x100
          reviewCount: 15,
        },
      },
    },
  });

  const designer = await prisma.expertProfile.create({
    data: {
      userId: expertUser2.id,
      slug: 'leo-designer',
      headline: 'Product designer — marketplaces',
      yearsOfExperience: 6,
      hourlyRateMinor: 280_000n,
      currency: INR,
      availabilityStatus: 'PARTIALLY_AVAILABLE',
      isAcceptingWork: true,
      verificationStatus: 'PENDING',
      profileCompleteness: 70,
      skills: {
        create: [
          { skillId: skills.get('ui-ux-design')!, proficiency: 'EXPERT', yearsOfExperience: 6, isPrimary: true },
        ],
      },
    },
  });

  await prisma.expertVerification.create({
    data: {
      expertId: designer.id,
      status: 'IN_REVIEW',
      aiFindings: {
        flags: ['Portfolio contains no verifiable client references'],
        confidence: 'medium',
        note: 'AI findings only — a human VERIFICATION_MANAGER decides (blueprint rule 6).',
      },
      aiFlagCount: 1,
    },
  });

  // Predefined service (the PREDEFINED_SERVICE entry flow)
  const service = await prisma.service.create({
    data: {
      expertId: expert.id,
      categoryId: webDev.id,
      title: 'Next.js performance audit (demo)',
      slug: 'nextjs-performance-audit-demo',
      description: 'Fixed-scope audit with a prioritized remediation plan.',
      status: 'ACTIVE',
      basePriceMinor: 4_500_000n, // ₹45,000.00
      currency: INR,
      deliveryDays: 10,
      revisionsIncluded: 2,
      packages: {
        create: [
          {
            tier: 'BASIC',
            name: 'Audit only',
            priceMinor: 4_500_000n,
            currency: INR,
            deliveryDays: 10,
            revisions: 1,
            features: ['Lighthouse audit', 'Prioritized findings'],
          },
          {
            tier: 'STANDARD',
            name: 'Audit + fixes',
            priceMinor: 9_000_000n,
            currency: INR,
            deliveryDays: 20,
            revisions: 2,
            features: ['Everything in Basic', 'Implementation of top 10 fixes'],
          },
        ],
      },
    },
  });

  // -------------------------------------------------------------------- AI
  console.log('- AI agents & run');
  const architectAgent = await prisma.aiAgent.create({
    data: {
      key: 'PROJECT_ARCHITECT',
      name: 'Project Architect Agent',
      description: 'Structures a free-text outcome into requirements.',
      defaultRiskTier: 'LOW',
      versions: {
        create: {
          version: '1.0.0',
          model: 'claude-opus-5',
          provider: 'anthropic',
          promptRef: 'prompts/project-architect@1.0.0',
          isActive: true,
        },
      },
    },
    include: { versions: true },
  });

  const matchingAgent = await prisma.aiAgent.create({
    data: {
      key: 'MATCHING',
      name: 'Matching Agent',
      description: 'Ranks experts with explainable per-dimension scores.',
      defaultRiskTier: 'MEDIUM',
      versions: {
        create: {
          version: '1.0.0',
          model: 'claude-opus-5',
          provider: 'anthropic',
          promptRef: 'prompts/matching@1.0.0',
          isActive: true,
        },
      },
    },
    include: { versions: true },
  });

  // --------------------------------------------------------------- PROJECTS
  console.log('- projects (all three entry sources)');

  // 1) POSTED_PROJECT — the flagship agentic flow, carried all the way through.
  const project = await prisma.project.create({
    data: {
      projectNumber: 'PRJ-2026-000001',
      customerId: customer.id,
      source: 'POSTED_PROJECT',
      status: 'ACTIVE',
      title: 'Rebuild customer account portal (demo)',
      description: 'Replace the legacy account area with a modern, faster portal.',
      categoryId: webDev.id,
      engagementType: 'FIXED_PRICE',
      complexity: 'MEDIUM',
      budgetMinMinor: 8_000_000n,
      budgetMaxMinor: 12_000_000n,
      currency: INR,
      estimatedEffortHours: 240,
      estimatedDurationDays: 45,
      estimatedBudgetMinMinor: 9_000_000n,
      estimatedBudgetMaxMinor: 11_000_000n,
      estimatedTeamSize: 2,
      submittedAt: new Date('2026-08-01'),
      activatedAt: new Date('2026-08-14'),
      skills: {
        create: [
          { skillId: skills.get('typescript')!, isRequired: true, importance: 5, minProficiency: 'ADVANCED' },
          { skillId: skills.get('react')!, isRequired: true, importance: 5, minProficiency: 'ADVANCED' },
          { skillId: skills.get('postgresql')!, isRequired: false, importance: 3 },
        ],
      },
    },
  });

  const architectRun = await prisma.aiRun.create({
    data: {
      agentId: architectAgent.id,
      agentVersionId: architectAgent.versions[0]!.id,
      model: 'claude-opus-5',
      provider: 'anthropic',
      projectId: project.id,
      entityType: 'Project',
      entityId: project.id,
      trigger: 'USER_REQUEST',
      triggeredByUserId: customerUser.id,
      status: 'SUCCEEDED',
      inputPayload: { description: 'Replace the legacy account area with a modern, faster portal.' },
      outputPayload: { requirementCount: 4, clarifications: 1 },
      validationStatus: 'PASSED',
      latencyMs: 8420,
      inputTokens: 1840,
      outputTokens: 960,
      cachedInputTokens: 1200,
      costMinor: 320n, // ₹3.20 — AI cost uses the same money convention
      currency: INR,
      startedAt: new Date('2026-08-01T10:00:00Z'),
      completedAt: new Date('2026-08-01T10:00:08Z'),
    },
  });

  await prisma.projectRequirement.createMany({
    data: [
      {
        projectId: project.id,
        type: 'OBJECTIVE',
        content: 'Reduce account page load time below 1.5s at p75.',
        source: 'AI_AGENT',
        aiRunId: architectRun.id,
        isApproved: true,
        orderIndex: 0,
      },
      {
        projectId: project.id,
        type: 'DELIVERABLE',
        content: 'Rebuilt account dashboard, profile and orders screens.',
        source: 'AI_AGENT',
        aiRunId: architectRun.id,
        isApproved: true,
        orderIndex: 1,
      },
      {
        projectId: project.id,
        type: 'CONSTRAINT',
        content: 'Must reuse the existing design system.',
        source: 'CUSTOMER',
        isApproved: true,
        orderIndex: 2,
      },
      {
        projectId: project.id,
        type: 'CLARIFICATION_QUESTION',
        content: 'Is SSO required at launch, or can it follow in a later phase?',
        source: 'AI_AGENT',
        aiRunId: architectRun.id,
        isApproved: false,
        orderIndex: 3,
      },
    ],
  });

  const matchRun = await prisma.aiRun.create({
    data: {
      agentId: matchingAgent.id,
      agentVersionId: matchingAgent.versions[0]!.id,
      model: 'claude-opus-5',
      provider: 'anthropic',
      projectId: project.id,
      entityType: 'Project',
      entityId: project.id,
      trigger: 'SYSTEM_EVENT',
      status: 'SUCCEEDED',
      inputPayload: { projectId: project.id, candidatePool: 24 },
      outputPayload: { recommended: 1 },
      validationStatus: 'PASSED',
      latencyMs: 6100,
      inputTokens: 3200,
      outputTokens: 720,
      costMinor: 410n,
      currency: INR,
      startedAt: new Date('2026-08-03T09:00:00Z'),
      completedAt: new Date('2026-08-03T09:00:06Z'),
    },
  });

  // Scores are basis points (9400 = 94.00%) — matches the explainability UI.
  const recommendation = await prisma.recommendation.create({
    data: {
      projectId: project.id,
      expertId: expert.id,
      aiRunId: matchRun.id,
      status: 'ACCEPTED',
      rank: 1,
      overallScore: 9400,
      skillScore: 9700,
      experienceScore: 9200,
      availabilityScore: 9500,
      budgetFitScore: 9000,
      ratingScore: 9800,
      pastPerformanceScore: 9300,
      onTimePerformanceScore: 9600,
      clientSatisfactionScore: 9400,
      responseTimeScore: 8800,
      certificationScore: 7500,
      rationale:
        'Strong TypeScript/React match with recent commerce replatform experience and immediate availability.',
      evidence: {
        matchedSkills: ['typescript', 'react', 'postgresql'],
        similarProjects: ['Headless commerce replatform (demo)'],
        availabilityHoursPerWeek: 30,
      },
      presentedAt: new Date('2026-08-03T09:05:00Z'),
      decidedByUserId: customerUser.id,
      decidedAt: new Date('2026-08-04T11:00:00Z'),
    },
  });

  // Agent proposed the assignment; a human approved it (blueprint rule 5).
  await prisma.aiAction.create({
    data: {
      aiRunId: matchRun.id,
      toolName: 'createAssignmentDraft',
      riskTier: 'HIGH',
      requestedPayload: { projectId: project.id, expertId: expert.id },
      status: 'APPROVED',
      policyDecision: 'REQUIRES_HUMAN_APPROVAL',
      policyReason: 'Assignment affects contractual relationships — HIGH risk tier.',
      requiresHumanApproval: true,
      approvedByUserId: admin.id,
      approvedAt: new Date('2026-08-04T11:05:00Z'),
      executedAt: new Date('2026-08-04T11:05:01Z'),
      entityType: 'Project',
      entityId: project.id,
      idempotencyKey: 'seed-assignment-draft-1',
    },
  });

  await prisma.application.create({
    data: {
      projectId: project.id,
      expertId: designer.id,
      status: 'SUBMITTED',
      coverLetter: 'Demo application from a second expert.',
      proposedRateMinor: 280_000n,
      currency: INR,
      proposedDurationDays: 40,
    },
  });

  await prisma.assignment.create({
    data: {
      projectId: project.id,
      expertId: expert.id,
      recommendationId: recommendation.id,
      status: 'ACTIVE',
      role: 'Lead Engineer',
      isAiInitiated: true,
      createdByUserId: admin.id,
      approvedByUserId: admin.id,
      approvedAt: new Date('2026-08-04T11:05:00Z'),
      invitedAt: new Date('2026-08-04T11:06:00Z'),
      respondedAt: new Date('2026-08-05T08:00:00Z'),
    },
  });

  // 2) DIRECT_HIRE
  await prisma.project.create({
    data: {
      projectNumber: 'PRJ-2026-000002',
      customerId: customer.id,
      source: 'DIRECT_HIRE',
      status: 'CONTRACT_PENDING',
      title: 'Design system refresh (demo)',
      description: 'Direct invitation to a specific designer.',
      categoryId: design.id,
      engagementType: 'HOURLY',
      currency: INR,
      invitedExpertId: designer.id,
    },
  });

  // 3) PREDEFINED_SERVICE
  await prisma.project.create({
    data: {
      projectNumber: 'PRJ-2026-000003',
      customerId: customer.id,
      source: 'PREDEFINED_SERVICE',
      status: 'PAYMENT_PENDING',
      title: 'Next.js performance audit (demo)',
      description: 'Purchased from the service catalog.',
      categoryId: webDev.id,
      engagementType: 'FIXED_PRICE',
      currency: INR,
      serviceId: service.id,
      budgetMinMinor: 4_500_000n,
      budgetMaxMinor: 4_500_000n,
    },
  });

  // --------------------------------------------------------------- CONTRACT
  console.log('- contract, milestones, deliverable');
  const contractTotal = money(10_000_000n, INR); // ₹100,000.00

  const contract = await prisma.contract.create({
    data: {
      contractNumber: 'CTR-2026-000001',
      projectId: project.id,
      customerId: customer.id,
      expertId: expert.id,
      type: 'FIXED_PRICE',
      status: 'ACTIVE',
      totalValueMinor: contractTotal.amountMinor,
      currency: INR,
      startDate: new Date('2026-08-14'),
      endDate: new Date('2026-09-30'),
      sentAt: new Date('2026-08-06'),
      acceptedAt: new Date('2026-08-08'),
      customerSignedAt: new Date('2026-08-08'),
      expertSignedAt: new Date('2026-08-08'),
      versions: {
        create: {
          versionNumber: 1,
          scope: 'Rebuild account dashboard, profile and orders screens.',
          terms: { revisionLimit: 2, ipTransfer: 'on final payment', supportDays: 30 },
          acceptanceCriteria: 'All screens pass acceptance tests and p75 load time < 1.5s.',
          totalValueMinor: contractTotal.amountMinor,
          currency: INR,
          createdByUserId: admin.id,
          isSigned: true,
          signedAt: new Date('2026-08-08'),
        },
      },
    },
  });

  const milestone1 = await prisma.milestone.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      title: 'Phase 1 — Dashboard & profile',
      description: 'Rebuild the dashboard and profile screens.',
      acceptanceCriteria: 'Screens match the design system and pass acceptance tests.',
      amountMinor: 4_000_000n, // ₹40,000.00
      currency: INR,
      status: 'APPROVED',
      orderIndex: 0,
      dueDate: new Date('2026-09-01'),
      fundedAt: new Date('2026-08-14'),
      startedAt: new Date('2026-08-15'),
      submittedAt: new Date('2026-08-29'),
      approvedAt: new Date('2026-08-31'),
    },
  });

  const milestone2 = await prisma.milestone.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      title: 'Phase 2 — Orders & history',
      amountMinor: 6_000_000n, // ₹60,000.00
      currency: INR,
      status: 'IN_PROGRESS',
      orderIndex: 1,
      dueDate: new Date('2026-09-25'),
      fundedAt: new Date('2026-09-01'),
      startedAt: new Date('2026-09-02'),
    },
  });

  const task = await prisma.task.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      milestoneId: milestone2.id,
      assignedExpertId: expert.id,
      title: 'Implement order history pagination',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      estimatedHours: 12,
      dueDate: new Date('2026-09-15'),
      startedAt: new Date('2026-09-05'),
    },
  });

  await prisma.timeEntry.create({
    data: {
      contractId: contract.id,
      expertId: expert.id,
      taskId: task.id,
      milestoneId: milestone2.id,
      startedAt: new Date('2026-09-05T09:00:00Z'),
      endedAt: new Date('2026-09-05T13:30:00Z'),
      durationMinutes: 270,
      description: 'Cursor pagination for order history.',
      isBillable: true,
      ratePerHourMinor: 350_000n,
      currency: INR,
      status: 'APPROVED',
      approvedByUserId: admin.id,
      approvedAt: new Date('2026-09-06T10:00:00Z'),
    },
  });

  await prisma.deliverable.create({
    data: {
      milestoneId: milestone1.id,
      submittedByExpertId: expert.id,
      title: 'Phase 1 delivery',
      description: 'Dashboard and profile screens, with test evidence.',
      version: 1,
      externalUrl: 'https://example.test/demo-delivery',
      status: 'APPROVED',
      reviewedByUserId: customerUser.id,
      reviewedAt: new Date('2026-08-31'),
      reviewNotes: 'Approved — meets acceptance criteria.',
    },
  });

  // ---------------------------------------------------------- COLLABORATION
  console.log('- conversation & notifications');
  const conversation = await prisma.conversation.create({
    data: {
      type: 'PROJECT',
      projectId: project.id,
      contractId: contract.id,
      title: 'Rebuild customer account portal (demo)',
      lastMessageAt: new Date('2026-09-05T12:00:00Z'),
      members: {
        create: [
          { userId: customerUser.id, lastReadAt: new Date('2026-09-05T12:05:00Z') },
          { userId: expertUser.id, lastReadAt: new Date('2026-09-05T12:01:00Z') },
        ],
      },
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderUserId: expertUser.id,
      type: 'USER',
      body: 'Phase 1 is submitted for review.',
      createdAt: new Date('2026-08-29T15:00:00Z'),
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      type: 'AI_AGENT',
      body: 'Milestone 2 is due in 20 days and reported progress is 35%.',
      aiRunId: matchRun.id,
      createdAt: new Date('2026-09-05T12:00:00Z'),
    },
  });

  await prisma.notification.create({
    data: {
      userId: customerUser.id,
      type: 'MILESTONE_SUBMITTED',
      channel: 'IN_APP',
      title: 'Milestone submitted',
      body: 'Phase 1 — Dashboard & profile has been submitted for your review.',
      entityType: 'Milestone',
      entityId: milestone1.id,
      actionUrl: `/projects/${project.id}/milestones`,
      sentAt: new Date('2026-08-29T15:01:00Z'),
    },
  });

  await prisma.notificationPreference.create({
    data: { userId: customerUser.id, type: 'MILESTONE_SUBMITTED', inApp: true, email: true },
  });

  // -------------------------------------------------------------- FINANCIAL
  console.log('- order, webhook-confirmed payment, balanced ledger');

  const commissionRule = await prisma.commissionRule.create({
    data: {
      name: 'Standard platform commission',
      scope: 'GLOBAL',
      calculationType: 'PERCENTAGE',
      percentageBasisPoints: 1000, // 10.00%
      version: 1,
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
      createdByUserId: superAdmin.id,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2026-000001',
      customerId: customer.id,
      projectId: project.id,
      contractId: contract.id,
      milestoneId: milestone1.id,
      type: 'MILESTONE_FUNDING',
      status: 'PAID',
      subtotalMinor: 4_000_000n,
      taxMinor: 0n,
      totalMinor: 4_000_000n,
      currency: INR,
      paidAt: new Date('2026-08-14T10:00:00Z'),
    },
  });

  // The webhook is what authorises SUCCEEDED — never a browser redirect.
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      provider: 'RAZORPAY',
      providerEventId: 'evt_seed_demo_0001',
      eventType: 'payment.captured',
      signatureVerified: true,
      payload: { id: 'evt_seed_demo_0001', event: 'payment.captured', note: 'fake development payload' },
      status: 'PROCESSED',
      attempts: 1,
      processedAt: new Date('2026-08-14T10:00:05Z'),
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      customerId: customer.id,
      provider: 'RAZORPAY',
      providerPaymentId: 'pay_seed_demo_0001',
      providerOrderId: 'order_seed_demo_0001',
      amountMinor: 4_000_000n,
      currency: INR,
      status: 'RELEASED',
      methodDescriptor: 'upi', // descriptor only — never card data
      idempotencyKey: 'seed-payment-milestone-1',
      initiatedAt: new Date('2026-08-14T09:59:00Z'),
      capturedAt: new Date('2026-08-14T10:00:05Z'),
      confirmedByWebhookEventId: webhookEvent.id,
      attempts: {
        create: [
          {
            attemptNumber: 1,
            provider: 'RAZORPAY',
            providerReference: 'pay_seed_demo_0001',
            status: 'SUCCEEDED',
            attemptedAt: new Date('2026-08-14T10:00:00Z'),
          },
        ],
      },
    },
  });

  // Commission computed with the SHARED money abstraction — no ad-hoc maths.
  const gross = money(milestone1.amountMinor, INR);
  const commissionAmount = applyBasisPoints(gross, commissionRule.percentageBasisPoints!);
  const expertPayable = subtract(gross, commissionAmount);

  const commission = await prisma.commission.create({
    data: {
      commissionRuleId: commissionRule.id,
      commissionRuleVersion: commissionRule.version,
      contractId: contract.id,
      milestoneId: milestone1.id,
      orderId: order.id,
      paymentId: payment.id,
      grossAmountMinor: gross.amountMinor,
      commissionAmountMinor: commissionAmount.amountMinor,
      expertPayableMinor: expertPayable.amountMinor,
      currency: INR,
      status: 'APPLIED',
      calculationSnapshot: {
        rule: commissionRule.name,
        version: commissionRule.version,
        calculationType: 'PERCENTAGE',
        percentageBasisPoints: commissionRule.percentageBasisPoints,
        grossMinor: gross.amountMinor.toString(),
        commissionMinor: commissionAmount.amountMinor.toString(),
        expertPayableMinor: expertPayable.amountMinor.toString(),
      },
    },
  });

  // Transaction 1 — capture: customer money enters escrow.
  await prisma.transaction.create({
    data: {
      transactionNumber: 'TXN-2026-000001',
      type: 'PAYMENT_CAPTURE',
      status: 'POSTED',
      paymentId: payment.id,
      orderId: order.id,
      projectId: project.id,
      contractId: contract.id,
      milestoneId: milestone1.id,
      amountMinor: 4_000_000n,
      currency: INR,
      description: 'Milestone 1 funding captured',
      occurredAt: new Date('2026-08-14T10:00:05Z'),
      ledgerEntries: {
        create: [
          { account: 'PLATFORM_CASH', entryType: 'DEBIT', amountMinor: 4_000_000n, currency: INR },
          { account: 'CUSTOMER_ESCROW', entryType: 'CREDIT', amountMinor: 4_000_000n, currency: INR },
        ],
      },
    },
  });

  // Transaction 2 — release: escrow splits into expert payable + commission.
  await prisma.transaction.create({
    data: {
      transactionNumber: 'TXN-2026-000002',
      type: 'MILESTONE_RELEASE',
      status: 'POSTED',
      paymentId: payment.id,
      projectId: project.id,
      contractId: contract.id,
      milestoneId: milestone1.id,
      amountMinor: 4_000_000n,
      currency: INR,
      description: 'Milestone 1 approved — funds released',
      occurredAt: new Date('2026-08-31T12:00:00Z'),
      ledgerEntries: {
        create: [
          { account: 'CUSTOMER_ESCROW', entryType: 'DEBIT', amountMinor: 4_000_000n, currency: INR },
          {
            account: 'EXPERT_PAYABLE',
            entryType: 'CREDIT',
            amountMinor: expertPayable.amountMinor,
            currency: INR,
            subjectType: 'ExpertProfile',
            subjectId: expert.id,
          },
          {
            account: 'PLATFORM_COMMISSION',
            entryType: 'CREDIT',
            amountMinor: commissionAmount.amountMinor,
            currency: INR,
          },
        ],
      },
    },
  });

  const payout = await prisma.payout.create({
    data: {
      payoutNumber: 'PYT-2026-000001',
      expertId: expert.id,
      provider: 'RAZORPAY',
      method: 'BANK_TRANSFER',
      grossAmountMinor: gross.amountMinor,
      commissionAmountMinor: commissionAmount.amountMinor,
      netAmountMinor: expertPayable.amountMinor,
      currency: INR,
      status: 'PAID',
      approvedByUserId: finance.id, // payouts require human approval
      approvedAt: new Date('2026-09-01T09:00:00Z'),
      idempotencyKey: 'seed-payout-milestone-1',
      processedAt: new Date('2026-09-01T10:00:00Z'),
      items: {
        create: [
          {
            milestoneId: milestone1.id,
            contractId: contract.id,
            commissionId: commission.id,
            amountMinor: expertPayable.amountMinor,
            currency: INR,
            description: 'Milestone 1 net payout',
          },
        ],
      },
    },
  });

  // Transaction 3 — payout: the payable is settled.
  await prisma.transaction.create({
    data: {
      transactionNumber: 'TXN-2026-000003',
      type: 'PAYOUT',
      status: 'POSTED',
      payoutId: payout.id,
      projectId: project.id,
      contractId: contract.id,
      milestoneId: milestone1.id,
      amountMinor: expertPayable.amountMinor,
      currency: INR,
      description: 'Payout to expert for milestone 1',
      occurredAt: new Date('2026-09-01T10:00:00Z'),
      ledgerEntries: {
        create: [
          {
            account: 'EXPERT_PAYABLE',
            entryType: 'DEBIT',
            amountMinor: expertPayable.amountMinor,
            currency: INR,
            subjectType: 'ExpertProfile',
            subjectId: expert.id,
          },
          {
            account: 'PLATFORM_CASH',
            entryType: 'CREDIT',
            amountMinor: expertPayable.amountMinor,
            currency: INR,
          },
        ],
      },
    },
  });

  // ------------------------------------------------------------- REPUTATION
  console.log('- review & ratings');
  await prisma.review.create({
    data: {
      projectId: project.id,
      contractId: contract.id,
      reviewerUserId: customerUser.id,
      revieweeUserId: expertUser.id,
      direction: 'CUSTOMER_TO_EXPERT',
      status: 'PUBLISHED',
      overallRating: 5,
      comment: 'Excellent communication and delivered ahead of schedule.',
      isVerifiedTransaction: true,
      publishedAt: new Date('2026-09-02'),
      ratings: {
        create: [
          { dimension: 'QUALITY', score: 5 },
          { dimension: 'COMMUNICATION', score: 5 },
          { dimension: 'TIMELINESS', score: 5 },
          { dimension: 'EXPERTISE', score: 5 },
          { dimension: 'PROFESSIONALISM', score: 5 },
          { dimension: 'VALUE', score: 4 },
        ],
      },
    },
  });

  // ------------------------------------------------------------- GOVERNANCE
  console.log('- audit log');
  await prisma.auditLog.createMany({
    data: [
      {
        actorType: 'USER',
        actorUserId: verifier.id,
        action: 'expert.verification.approved',
        entityType: 'ExpertProfile',
        entityId: expert.id,
        afterState: { verificationStatus: 'VERIFIED' },
        severity: 'NOTICE',
        requestId: 'seed-req-0001',
      },
      {
        actorType: 'AI_AGENT',
        actorAiRunId: matchRun.id,
        action: 'ai.recommendation.created',
        entityType: 'Recommendation',
        entityId: recommendation.id,
        afterState: { overallScore: 9400, rank: 1 },
        severity: 'INFO',
        requestId: 'seed-req-0002',
      },
      {
        actorType: 'USER',
        actorUserId: finance.id,
        action: 'payout.approved',
        entityType: 'Payout',
        entityId: payout.id,
        afterState: { status: 'PAID', netAmountMinor: expertPayable.amountMinor.toString() },
        severity: 'CRITICAL',
        requestId: 'seed-req-0003',
      },
    ],
  });

  // --------------------------------------------------------------- VERIFY
  console.log('- verifying ledger balance');
  const ledgerRows = await prisma.ledgerEntry.findMany({
    select: { entryType: true, amountMinor: true },
  });
  const debits = ledgerRows
    .filter((r) => r.entryType === 'DEBIT')
    .reduce((acc, r) => acc + r.amountMinor, 0n);
  const credits = ledgerRows
    .filter((r) => r.entryType === 'CREDIT')
    .reduce((acc, r) => acc + r.amountMinor, 0n);

  if (debits !== credits) {
    throw new Error(`Ledger does not balance: debits ${debits} !== credits ${credits}`);
  }
  console.log(`  ledger balanced: ${debits} debit = ${credits} credit (minor units)`);

  const counts = {
    users: await prisma.user.count(),
    experts: await prisma.expertProfile.count(),
    projects: await prisma.project.count(),
    contracts: await prisma.contract.count(),
    milestones: await prisma.milestone.count(),
    payments: await prisma.payment.count(),
    ledgerEntries: await prisma.ledgerEntry.count(),
    aiRuns: await prisma.aiRun.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
