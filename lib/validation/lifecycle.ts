/**
 * Zod schemas for the lifecycle transition API.
 *
 * `confirm` exists for one purpose: a caller acting on platform authority must
 * confirm a HIGH or CRITICAL transition deliberately, against the status they
 * reviewed (see `lib/http/lifecycle.ts`). A party acting on their own
 * engagement never needs it.
 *
 * `strictObject` throughout, so a client cannot smuggle in anything the server
 * decides: not the actor (always the session's human), not a webhook event id,
 * not a refunded amount, not a failure code. Those exist only for server-side
 * callers and are deliberately absent here.
 *
 * `event` is any event of the machine — including SYSTEM- and WEBHOOK-only ones.
 * Rejecting those is the lifecycle service's job, so the attempt is refused with
 * ACTOR_NOT_PERMITTED and audited rather than disappearing as a 422.
 */

import { z } from 'zod';

import { CONTRACT_EVENTS, CONTRACT_STATES } from '../../domain/contract/state-machine';
import { MILESTONE_EVENTS, MILESTONE_STATES } from '../../domain/milestone/state-machine';
import { PAYMENT_EVENTS, PAYMENT_STATES } from '../../domain/payment/state-machine';
import { PROJECT_EVENTS, PROJECT_STATES } from '../../domain/project/state-machine';

export const transitionParamsSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  notes: z.string().trim().min(1).max(5000).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignmentId: z.uuid().optional(),
  resolution: z.enum(['RESOLVED_CUSTOMER', 'RESOLVED_EXPERT', 'RESOLVED_SPLIT', 'WITHDRAWN']).optional(),
});

export const projectTransitionSchema = z.strictObject({
  event: z.enum(PROJECT_EVENTS),
  expectedStatus: z.enum(PROJECT_STATES).optional(),
  confirm: z.boolean().optional(),
  params: transitionParamsSchema.optional(),
});

export const contractTransitionSchema = z.strictObject({
  event: z.enum(CONTRACT_EVENTS),
  expectedStatus: z.enum(CONTRACT_STATES).optional(),
  confirm: z.boolean().optional(),
  params: transitionParamsSchema.optional(),
});

export const milestoneTransitionSchema = z.strictObject({
  event: z.enum(MILESTONE_EVENTS),
  expectedStatus: z.enum(MILESTONE_STATES).optional(),
  confirm: z.boolean().optional(),
  params: transitionParamsSchema.optional(),
});

export const paymentTransitionSchema = z.strictObject({
  event: z.enum(PAYMENT_EVENTS),
  expectedStatus: z.enum(PAYMENT_STATES).optional(),
  confirm: z.boolean().optional(),
  params: transitionParamsSchema.optional(),
});

export type TransitionBody = z.infer<typeof projectTransitionSchema>;
