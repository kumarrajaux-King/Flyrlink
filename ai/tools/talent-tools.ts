/**
 * Talent-domain tools: expert discovery, profile, availability, performance.
 *
 * All read-only (LOW risk). Every query is scoped so an agent only sees experts
 * who are discoverable — not soft-deleted, and (for search) accepting work. The
 * agent never receives raw rows; each tool returns a deliberately narrow shape,
 * which is both a privacy boundary and a token-cost control.
 */

import { z } from 'zod';

import { registerTool, type ToolContext } from './registry';

/** Scores and rates are basis points in the database; expose them as-is. */
const basisPoints = z.number().int().min(0).max(10_000);

const expertSummarySchema = z.object({
  expertId: z.string(),
  slug: z.string(),
  headline: z.string().nullable(),
  yearsOfExperience: z.number().int(),
  hourlyRateMinor: z.string().nullable(),
  currency: z.string().nullable(),
  availabilityStatus: z.string(),
  verificationStatus: z.string(),
  skills: z.array(z.object({ name: z.string(), proficiency: z.string(), years: z.number().int() })),
  avgRating: z.number().int(),
  reviewCount: z.number().int(),
  completedProjects: z.number().int(),
});

export const searchExpertsTool = registerTool({
  name: 'searchExperts',
  description:
    'Find experts matching skills, budget and availability. Returns a ranked-by-rating shortlist ' +
    'of discoverable, non-deleted experts who are accepting work. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'expert:read:any',
  idempotent: true,
  auditAction: 'ai.tool.searchExperts',
  inputSchema: z.object({
    skillSlugs: z.array(z.string()).max(20).optional(),
    minYearsExperience: z.number().int().min(0).max(60).optional(),
    maxHourlyRateMinor: z.number().int().min(0).optional(),
    onlyVerified: z.boolean().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  outputSchema: z.object({
    experts: z.array(expertSummarySchema),
    totalConsidered: z.number().int(),
  }),
  handler: async (input, context: ToolContext) => {
    const limit = input.limit ?? 10;

    const experts = await context.db.expertProfile.findMany({
      where: {
        deletedAt: null,
        isAcceptingWork: true,
        ...(input.onlyVerified ? { verificationStatus: 'VERIFIED' } : {}),
        ...(input.minYearsExperience !== undefined
          ? { yearsOfExperience: { gte: input.minYearsExperience } }
          : {}),
        ...(input.maxHourlyRateMinor !== undefined
          ? { hourlyRateMinor: { lte: BigInt(input.maxHourlyRateMinor) } }
          : {}),
        ...(input.skillSlugs && input.skillSlugs.length > 0
          ? { skills: { some: { skill: { slug: { in: input.skillSlugs } } } } }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        headline: true,
        yearsOfExperience: true,
        hourlyRateMinor: true,
        currency: true,
        availabilityStatus: true,
        verificationStatus: true,
        skills: {
          select: {
            proficiency: true,
            yearsOfExperience: true,
            skill: { select: { name: true } },
          },
        },
        performance: {
          select: { avgRating: true, reviewCount: true, completedProjects: true },
        },
      },
      take: limit,
      orderBy: [{ performance: { avgRating: 'desc' } }, { yearsOfExperience: 'desc' }],
    });

    return {
      experts: experts.map((expert) => ({
        expertId: expert.id,
        slug: expert.slug,
        headline: expert.headline,
        yearsOfExperience: expert.yearsOfExperience,
        // BigInt is not JSON-serialisable; strings keep the exact value.
        hourlyRateMinor: expert.hourlyRateMinor?.toString() ?? null,
        currency: expert.currency,
        availabilityStatus: expert.availabilityStatus,
        verificationStatus: expert.verificationStatus,
        skills: expert.skills.map((link) => ({
          name: link.skill.name,
          proficiency: link.proficiency,
          years: link.yearsOfExperience,
        })),
        avgRating: expert.performance?.avgRating ?? 0,
        reviewCount: expert.performance?.reviewCount ?? 0,
        completedProjects: expert.performance?.completedProjects ?? 0,
      })),
      totalConsidered: experts.length,
    };
  },
});

export const getExpertProfileTool = registerTool({
  name: 'getExpertProfile',
  description:
    'Fetch one expert profile with skills, certifications and portfolio titles. ' +
    'Contact details are never included. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'expert:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getExpertProfile',
  inputSchema: z.object({ expertId: z.string() }),
  outputSchema: z
    .object({
      expertId: z.string(),
      slug: z.string(),
      headline: z.string().nullable(),
      bio: z.string().nullable(),
      yearsOfExperience: z.number().int(),
      verificationStatus: z.string(),
      profileCompleteness: z.number().int(),
      skills: z.array(z.object({ name: z.string(), proficiency: z.string() })),
      certifications: z.array(
        z.object({ name: z.string(), issuer: z.string(), status: z.string() }),
      ),
      portfolio: z.array(z.object({ title: z.string(), completedAt: z.string().nullable() })),
    })
    .nullable(),
  handler: async (input, context: ToolContext) => {
    const expert = await context.db.expertProfile.findFirst({
      where: { id: input.expertId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        headline: true,
        bio: true,
        yearsOfExperience: true,
        verificationStatus: true,
        profileCompleteness: true,
        skills: { select: { proficiency: true, skill: { select: { name: true } } } },
        certifications: {
          select: { name: true, issuingOrganization: true, verificationStatus: true },
        },
        portfolioItems: {
          where: { isPublic: true },
          select: { title: true, completedAt: true },
        },
      },
    });

    if (!expert) return null;

    return {
      expertId: expert.id,
      slug: expert.slug,
      headline: expert.headline,
      bio: expert.bio,
      yearsOfExperience: expert.yearsOfExperience,
      verificationStatus: expert.verificationStatus,
      profileCompleteness: expert.profileCompleteness,
      skills: expert.skills.map((s) => ({ name: s.skill.name, proficiency: s.proficiency })),
      certifications: expert.certifications.map((c) => ({
        name: c.name,
        issuer: c.issuingOrganization,
        status: c.verificationStatus,
      })),
      portfolio: expert.portfolioItems.map((p) => ({
        title: p.title,
        completedAt: p.completedAt?.toISOString() ?? null,
      })),
    };
  },
});

export const getExpertAvailabilityTool = registerTool({
  name: 'getExpertAvailability',
  description:
    'Weekly availability windows and capacity for one expert. Times are minutes from midnight ' +
    'in the expert timezone. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'expert:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getExpertAvailability',
  inputSchema: z.object({ expertId: z.string() }),
  outputSchema: z
    .object({
      expertId: z.string(),
      availabilityStatus: z.string(),
      weeklyCapacityHours: z.number().int().nullable(),
      timezone: z.string(),
      windows: z.array(
        z.object({
          dayOfWeek: z.number().int(),
          startMinute: z.number().int(),
          endMinute: z.number().int(),
        }),
      ),
    })
    .nullable(),
  handler: async (input, context: ToolContext) => {
    const expert = await context.db.expertProfile.findFirst({
      where: { id: input.expertId, deletedAt: null },
      select: {
        id: true,
        availabilityStatus: true,
        weeklyCapacityHours: true,
        timezone: true,
        availability: {
          select: { dayOfWeek: true, startMinute: true, endMinute: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
        },
      },
    });

    if (!expert) return null;

    return {
      expertId: expert.id,
      availabilityStatus: expert.availabilityStatus,
      weeklyCapacityHours: expert.weeklyCapacityHours,
      timezone: expert.timezone,
      windows: expert.availability,
    };
  },
});

export const getExpertPerformanceTool = registerTool({
  name: 'getExpertPerformance',
  description:
    'Internal performance signals for one expert: on-time delivery, revision, cancellation and ' +
    'dispute rates (basis points), plus completed project count. Read-only.',
  riskTier: 'LOW',
  requiredPermission: 'expert:read:any',
  idempotent: true,
  auditAction: 'ai.tool.getExpertPerformance',
  inputSchema: z.object({ expertId: z.string() }),
  outputSchema: z
    .object({
      expertId: z.string(),
      onTimeDeliveryRate: basisPoints,
      revisionRate: basisPoints,
      cancellationRate: basisPoints,
      disputeRate: basisPoints,
      repeatClientRate: basisPoints,
      clientSatisfaction: basisPoints,
      avgResponseMinutes: z.number().int().nullable(),
      completedProjects: z.number().int(),
      avgRating: z.number().int(),
      reviewCount: z.number().int(),
    })
    .nullable(),
  handler: async (input, context: ToolContext) => {
    const performance = await context.db.expertPerformance.findUnique({
      where: { expertId: input.expertId },
      select: {
        expertId: true,
        onTimeDeliveryRate: true,
        revisionRate: true,
        cancellationRate: true,
        disputeRate: true,
        repeatClientRate: true,
        clientSatisfaction: true,
        avgResponseMinutes: true,
        completedProjects: true,
        avgRating: true,
        reviewCount: true,
      },
    });

    return performance ?? null;
  },
});
