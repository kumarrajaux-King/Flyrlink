/**
 * Project-domain tools: context, requirements, estimates, recommendations,
 * milestone/contract/assignment drafts, notifications and payment status.
 *
 * Everything an agent can write here is a **draft or a proposal**. Nothing
 * transitions a state machine, moves money, or binds a party. The write tools
 * produce rows that a human must act on:
 *
 *   - requirements land with `source = AI_AGENT` and `isApproved = false`
 *   - recommendations land as `PROPOSED`
 *   - milestones land as `DRAFT`
 *   - contract versions land unsigned
 *   - assignments land as `DRAFT` with `isAiInitiated = true`
 */

import { z } from 'zod';

import type { Prisma } from '../../src/generated/prisma/client';
import { notify } from '../../services/notification/notification-service';
import { registerTool, type ToolContext } from './registry';

const scoreBasisPoints = z.number().int().min(0).max(10_000);

export const getProjectContextTool = registerTool({
  name: 'getProjectContext',
  description:
    'Full working context for one project: description, budget range, engagement type, current ' +
    'status, required skills and existing requirements. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'project:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getProjectContext',
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z
    .object({
      projectId: z.string(),
      projectNumber: z.string(),
      source: z.string(),
      status: z.string(),
      title: z.string(),
      description: z.string(),
      engagementType: z.string(),
      complexity: z.string().nullable(),
      currency: z.string(),
      budgetMinMinor: z.string().nullable(),
      budgetMaxMinor: z.string().nullable(),
      deadline: z.string().nullable(),
      skills: z.array(
        z.object({ name: z.string(), slug: z.string(), isRequired: z.boolean(), importance: z.number().int() }),
      ),
      requirements: z.array(
        z.object({
          type: z.string(),
          content: z.string(),
          source: z.string(),
          isApproved: z.boolean(),
        }),
      ),
    })
    .nullable(),
  handler: async (input, context: ToolContext) => {
    const project = await context.db.project.findFirst({
      where: { id: input.projectId, deletedAt: null },
      select: {
        id: true,
        projectNumber: true,
        source: true,
        status: true,
        title: true,
        description: true,
        engagementType: true,
        complexity: true,
        currency: true,
        budgetMinMinor: true,
        budgetMaxMinor: true,
        deadline: true,
        skills: {
          select: {
            isRequired: true,
            importance: true,
            skill: { select: { name: true, slug: true } },
          },
        },
        requirements: {
          select: { type: true, content: true, source: true, isApproved: true },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!project) return null;

    return {
      projectId: project.id,
      projectNumber: project.projectNumber,
      source: project.source,
      status: project.status,
      title: project.title,
      description: project.description,
      engagementType: project.engagementType,
      complexity: project.complexity,
      currency: project.currency,
      budgetMinMinor: project.budgetMinMinor?.toString() ?? null,
      budgetMaxMinor: project.budgetMaxMinor?.toString() ?? null,
      deadline: project.deadline?.toISOString() ?? null,
      skills: project.skills.map((link) => ({
        name: link.skill.name,
        slug: link.skill.slug,
        isRequired: link.isRequired,
        importance: link.importance,
      })),
      requirements: project.requirements,
    };
  },
});

export const saveProjectRequirementsTool = registerTool({
  name: 'saveProjectRequirements',
  description:
    'Persist structured requirements extracted from a project brief. Each is stored unapproved ' +
    'and attributed to the agent, so the customer reviews and edits before anything depends on it.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
  idempotent: false,
  auditAction: 'ai.tool.saveProjectRequirements',
  inputSchema: z.object({
    projectId: z.string(),
    requirements: z
      .array(
        z.object({
          type: z.enum([
            'OBJECTIVE',
            'SCOPE',
            'DELIVERABLE',
            'CONSTRAINT',
            'DEPENDENCY',
            'ASSUMPTION',
            'CLARIFICATION_QUESTION',
            'MISSING_INFORMATION',
          ]),
          content: z.string().min(1).max(2000),
          priority: z.number().int().min(0).max(10).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  outputSchema: z.object({ created: z.number().int() }),
  handler: async (input, context: ToolContext) => {
    const project = await context.db.project.findFirst({
      where: { id: input.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!project) return { created: 0 };

    const existing = await context.db.projectRequirement.count({
      where: { projectId: project.id },
    });

    await context.db.projectRequirement.createMany({
      data: input.requirements.map((requirement, index) => ({
        projectId: project.id,
        type: requirement.type,
        content: requirement.content,
        priority: requirement.priority ?? 0,
        orderIndex: existing + index,
        source: 'AI_AGENT' as const,
        aiRunId: context.aiRunId,
        // Never auto-approved. The customer decides (A-06).
        isApproved: false,
      })),
    });

    return { created: input.requirements.length };
  },
});

export const saveProjectEstimateTool = registerTool({
  name: 'saveProjectEstimate',
  description:
    'Record an advisory estimate on a project: effort, duration, budget range, team size and ' +
    'complexity. These are recommendations, never quotes, and do not change the project budget.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
  idempotent: true,
  auditAction: 'ai.tool.saveProjectEstimate',
  inputSchema: z.object({
    projectId: z.string(),
    estimatedEffortHours: z.number().int().min(1).max(100_000),
    estimatedDurationDays: z.number().int().min(1).max(3650),
    estimatedBudgetMinMinor: z.number().int().min(0),
    estimatedBudgetMaxMinor: z.number().int().min(0),
    estimatedTeamSize: z.number().int().min(1).max(50),
    complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']),
  }),
  outputSchema: z.object({ saved: z.boolean() }),
  handler: async (input, context: ToolContext) => {
    if (input.estimatedBudgetMinMinor > input.estimatedBudgetMaxMinor) {
      // The database CHECK would reject this anyway; failing here gives the
      // model a clear, correctable error instead of a constraint violation.
      throw new Error('estimatedBudgetMinMinor must not exceed estimatedBudgetMaxMinor.');
    }

    const updated = await context.db.project.updateMany({
      where: { id: input.projectId, deletedAt: null },
      data: {
        estimatedEffortHours: input.estimatedEffortHours,
        estimatedDurationDays: input.estimatedDurationDays,
        estimatedBudgetMinMinor: BigInt(input.estimatedBudgetMinMinor),
        estimatedBudgetMaxMinor: BigInt(input.estimatedBudgetMaxMinor),
        estimatedTeamSize: input.estimatedTeamSize,
        complexity: input.complexity,
      },
    });

    return { saved: updated.count > 0 };
  },
});

export const createRecommendationTool = registerTool({
  name: 'createRecommendation',
  description:
    'Record an explainable expert recommendation with per-dimension scores in basis points, a ' +
    'plain-language rationale and the evidence used. Stored as PROPOSED for human decision.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
  idempotent: false,
  auditAction: 'ai.tool.createRecommendation',
  inputSchema: z.object({
    projectId: z.string(),
    expertId: z.string(),
    rank: z.number().int().min(1).max(50),
    overallScore: scoreBasisPoints,
    skillScore: scoreBasisPoints.optional(),
    experienceScore: scoreBasisPoints.optional(),
    similarProjectScore: scoreBasisPoints.optional(),
    availabilityScore: scoreBasisPoints.optional(),
    budgetFitScore: scoreBasisPoints.optional(),
    ratingScore: scoreBasisPoints.optional(),
    pastPerformanceScore: scoreBasisPoints.optional(),
    certificationScore: scoreBasisPoints.optional(),
    rationale: z.string().min(1).max(2000),
    evidence: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.object({ recommendationId: z.string().nullable() }),
  handler: async (input, context: ToolContext) => {
    const [project, expert] = await Promise.all([
      context.db.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true },
      }),
      context.db.expertProfile.findFirst({
        where: { id: input.expertId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!project || !expert) return { recommendationId: null };

    const created = await context.db.recommendation.create({
      data: {
        projectId: project.id,
        expertId: expert.id,
        aiRunId: context.aiRunId,
        status: 'PROPOSED',
        rank: input.rank,
        overallScore: input.overallScore,
        skillScore: input.skillScore ?? null,
        experienceScore: input.experienceScore ?? null,
        similarProjectScore: input.similarProjectScore ?? null,
        availabilityScore: input.availabilityScore ?? null,
        budgetFitScore: input.budgetFitScore ?? null,
        ratingScore: input.ratingScore ?? null,
        pastPerformanceScore: input.pastPerformanceScore ?? null,
        certificationScore: input.certificationScore ?? null,
        rationale: input.rationale,
        // Prisma's JSON input type is narrower than Record<string, unknown> and
        // TypeScript cannot prove `unknown` is serialisable. The cast is confined
        // to this boundary; the value was already Zod-validated.
        ...(input.evidence ? { evidence: input.evidence as Prisma.InputJsonValue } : {}),
      },
      select: { id: true },
    });

    return { recommendationId: created.id };
  },
});

export const createMilestoneDraftTool = registerTool({
  name: 'createMilestoneDraft',
  description:
    'Add a DRAFT milestone to a contract with a title, acceptance criteria and amount in minor ' +
    'units. Draft milestones are unfunded and non-binding until a human advances them.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
  idempotent: false,
  auditAction: 'ai.tool.createMilestoneDraft',
  inputSchema: z.object({
    contractId: z.string(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    acceptanceCriteria: z.string().max(2000).optional(),
    amountMinor: z.number().int().min(0),
    orderIndex: z.number().int().min(0).max(100),
    dueInDays: z.number().int().min(1).max(3650).optional(),
  }),
  outputSchema: z.object({ milestoneId: z.string().nullable() }),
  handler: async (input, context: ToolContext) => {
    const contract = await context.db.contract.findUnique({
      where: { id: input.contractId },
      select: { id: true, projectId: true, currency: true },
    });
    if (!contract) return { milestoneId: null };

    const created = await context.db.milestone.create({
      data: {
        contractId: contract.id,
        projectId: contract.projectId,
        title: input.title,
        description: input.description ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        amountMinor: BigInt(input.amountMinor),
        currency: contract.currency,
        status: 'DRAFT',
        orderIndex: input.orderIndex,
        dueDate:
          input.dueInDays !== undefined
            ? new Date(Date.now() + input.dueInDays * 24 * 60 * 60 * 1000)
            : null,
        aiRunId: context.aiRunId,
      },
      select: { id: true },
    });

    return { milestoneId: created.id };
  },
});

export const createContractDraftTool = registerTool({
  name: 'createContractDraft',
  description:
    'Propose a new UNSIGNED contract version with scope, terms and acceptance criteria. It does ' +
    'not send, sign or activate anything — a human must review and execute it.',
  // HIGH: contractual effect, even as a draft. A human approves before it is written.
  riskTier: 'HIGH',
  requiredPermission: 'project:update:any',
  idempotent: false,
  auditAction: 'ai.tool.createContractDraft',
  inputSchema: z.object({
    contractId: z.string(),
    scope: z.string().min(1).max(8000),
    acceptanceCriteria: z.string().max(4000).optional(),
    terms: z.record(z.string(), z.unknown()),
    changeReason: z.string().max(500).optional(),
  }),
  outputSchema: z.object({
    contractVersionId: z.string().nullable(),
    versionNumber: z.number().int().nullable(),
  }),
  handler: async (input, context: ToolContext) => {
    const contract = await context.db.contract.findUnique({
      where: { id: input.contractId },
      select: { id: true, totalValueMinor: true, currency: true },
    });
    if (!contract) return { contractVersionId: null, versionNumber: null };

    const latest = await context.db.contractVersion.findFirst({
      where: { contractId: contract.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const created = await context.db.contractVersion.create({
      data: {
        contractId: contract.id,
        versionNumber,
        scope: input.scope,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        terms: input.terms as Prisma.InputJsonValue,
        totalValueMinor: contract.totalValueMinor,
        currency: contract.currency,
        aiRunId: context.aiRunId,
        // Never signed by an agent. Signature is a human act.
        isSigned: false,
        changeReason: input.changeReason ?? 'Drafted by AI contract agent',
      },
      select: { id: true },
    });

    return { contractVersionId: created.id, versionNumber };
  },
});

export const createAssignmentDraftTool = registerTool({
  name: 'createAssignmentDraft',
  description:
    'Propose assigning an expert to a project. Created as a DRAFT flagged AI-initiated; it does ' +
    'not invite, notify or commit anyone until a human approves it.',
  // HIGH: this is the step that leads to a commercial relationship.
  riskTier: 'HIGH',
  requiredPermission: 'project:assign:any',
  idempotent: false,
  auditAction: 'ai.tool.createAssignmentDraft',
  inputSchema: z.object({
    projectId: z.string(),
    expertId: z.string(),
    recommendationId: z.string().optional(),
    role: z.string().max(120).optional(),
  }),
  outputSchema: z.object({ assignmentId: z.string().nullable() }),
  handler: async (input, context: ToolContext) => {
    const [project, expert] = await Promise.all([
      context.db.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true },
      }),
      context.db.expertProfile.findFirst({
        where: { id: input.expertId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!project || !expert) return { assignmentId: null };

    const created = await context.db.assignment.create({
      data: {
        projectId: project.id,
        expertId: expert.id,
        recommendationId: input.recommendationId ?? null,
        role: input.role ?? null,
        status: 'DRAFT',
        isAiInitiated: true,
      },
      select: { id: true },
    });

    return { assignmentId: created.id };
  },
});

export const getMilestoneStatusTool = registerTool({
  name: 'getMilestoneStatus',
  description:
    'Milestone states, due dates and revision counts for a project. Used to detect deadline and ' +
    'scope risk. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'milestone:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getMilestoneStatus',
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({
    milestones: z.array(
      z.object({
        milestoneId: z.string(),
        title: z.string(),
        status: z.string(),
        amountMinor: z.string(),
        currency: z.string(),
        dueDate: z.string().nullable(),
        submittedAt: z.string().nullable(),
        approvedAt: z.string().nullable(),
        revisionCount: z.number().int(),
      }),
    ),
  }),
  handler: async (input, context: ToolContext) => {
    const milestones = await context.db.milestone.findMany({
      where: { projectId: input.projectId },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        title: true,
        status: true,
        amountMinor: true,
        currency: true,
        dueDate: true,
        submittedAt: true,
        approvedAt: true,
        revisionCount: true,
      },
    });

    return {
      milestones: milestones.map((milestone) => ({
        milestoneId: milestone.id,
        title: milestone.title,
        status: milestone.status,
        amountMinor: milestone.amountMinor.toString(),
        currency: milestone.currency,
        dueDate: milestone.dueDate?.toISOString() ?? null,
        submittedAt: milestone.submittedAt?.toISOString() ?? null,
        approvedAt: milestone.approvedAt?.toISOString() ?? null,
        revisionCount: milestone.revisionCount,
      })),
    };
  },
});

export const getPaymentStatusTool = registerTool({
  name: 'getPaymentStatus',
  description:
    'Payment states and amounts for a project, for monitoring only. Cannot initiate, capture, ' +
    'release or refund anything. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'payment:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getPaymentStatus',
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({
    payments: z.array(
      z.object({
        paymentId: z.string(),
        status: z.string(),
        amountMinor: z.string(),
        refundedAmountMinor: z.string(),
        currency: z.string(),
        provider: z.string(),
        capturedAt: z.string().nullable(),
        failureCode: z.string().nullable(),
      }),
    ),
  }),
  handler: async (input, context: ToolContext) => {
    const payments = await context.db.payment.findMany({
      where: { order: { projectId: input.projectId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        amountMinor: true,
        refundedAmountMinor: true,
        currency: true,
        provider: true,
        capturedAt: true,
        failureCode: true,
      },
    });

    return {
      payments: payments.map((payment) => ({
        paymentId: payment.id,
        status: payment.status,
        amountMinor: payment.amountMinor.toString(),
        refundedAmountMinor: payment.refundedAmountMinor.toString(),
        currency: payment.currency,
        provider: payment.provider,
        capturedAt: payment.capturedAt?.toISOString() ?? null,
        failureCode: payment.failureCode,
      })),
    };
  },
});

export const sendNotificationTool = registerTool({
  name: 'sendNotification',
  description:
    'Create an in-app notification for a project participant. In-app only, reversible, and never ' +
    'used to make a commercial or contractual commitment.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:read:any',
  idempotent: false,
  auditAction: 'ai.tool.sendNotification',
  inputSchema: z.object({
    userId: z.string(),
    type: z.enum([
      'PROJECT_ANALYZED',
      'EXPERT_RECOMMENDED',
      'MILESTONE_DUE',
      'PROJECT_AT_RISK',
      'REVIEW_REQUESTED',
      'AI_APPROVAL_REQUIRED',
    ]),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(1000),
    entityType: z.string().max(60).optional(),
    entityId: z.string().optional(),
    actionUrl: z.string().max(500).optional(),
  }),
  outputSchema: z.object({ notificationId: z.string().nullable() }),
  handler: async (input, context: ToolContext) => {
    // Phase 9: routed through the notification service rather than writing the
    // row directly. An agent's notification is now subject to exactly the same
    // preferences as a notification the platform raises itself — an agent
    // cannot reach a channel the recipient has switched off, and cannot reach
    // them at all where routing says it should not. A missing or closed account
    // yields no notification, as before.
    const created = await notify(context.db, {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionUrl: input.actionUrl ?? null,
    });

    return { notificationId: created[0] ?? null };
  },
});
