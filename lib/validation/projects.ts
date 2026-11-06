/**
 * Zod schemas for the project API.
 *
 * `strictObject` throughout, so a client cannot smuggle in anything the server
 * decides: not the customer, not the project number, not the status, not the
 * AI-produced estimate fields, and not `source` beyond the one entry flow this
 * endpoint serves. Those exist only for server-side callers and are
 * deliberately absent here.
 *
 * A brief is the one field with a generous limit: the intake flow asks people
 * to describe an outcome in their own words, and truncating that at a few
 * hundred characters would defeat the point of the analysis that follows.
 */

import { z } from 'zod';

import { MAX_PAGE_SIZE } from './admin';

/** Long enough for a real brief, bounded so it cannot be used as storage. */
export const BRIEF_MAX_LENGTH = 8_000;

export const PROJECT_TITLE_MAX_LENGTH = 160;

export const createProjectSchema = z.strictObject({
  title: z.string().trim().min(3).max(PROJECT_TITLE_MAX_LENGTH),
  description: z.string().trim().min(20, 'Describe the outcome in a sentence or two.').max(BRIEF_MAX_LENGTH),
  // Advisory only, and the customer's own figure — never the AI's estimate,
  // which the agent writes through its own tool.
  budgetMinMinor: z.coerce.bigint().min(0n).optional(),
  budgetMaxMinor: z.coerce.bigint().min(0n).optional(),
  currency: z.string().length(3).toUpperCase().default('INR'),
  engagementType: z.enum(['FIXED_PRICE', 'HOURLY']).default('FIXED_PRICE'),
  deadline: z.iso.datetime().optional(),
}).refine(
  (value) =>
    value.budgetMinMinor === undefined ||
    value.budgetMaxMinor === undefined ||
    value.budgetMaxMinor >= value.budgetMinMinor,
  { message: 'The maximum budget cannot be below the minimum.', path: ['budgetMaxMinor'] },
);

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.strictObject({
  title: z.string().trim().min(3).max(PROJECT_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().min(20).max(BRIEF_MAX_LENGTH).optional(),
  budgetMinMinor: z.coerce.bigint().min(0n).optional(),
  budgetMaxMinor: z.coerce.bigint().min(0n).optional(),
  deadline: z.iso.datetime().nullable().optional(),
});

export const projectListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  status: z
    .enum([
      'DRAFT',
      'SUBMITTED',
      'AI_ANALYSIS',
      'REQUIREMENT_REVIEW',
      'MATCHING',
      'RECOMMENDED',
      'AWAITING_APPROVAL',
      'ASSIGNMENT_PENDING',
      'CONTRACT_PENDING',
      'PAYMENT_PENDING',
      'ACTIVE',
      'AT_RISK',
      'COMPLETED',
      'REVIEW_PENDING',
      'CLOSED',
      'CANCELLED',
      'DISPUTED',
      'SUSPENDED',
    ])
    .optional(),
});
