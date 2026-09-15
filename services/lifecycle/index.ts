/**
 * Lifecycle services — the only application code that changes a Project,
 * Contract, Milestone or Payment status.
 *
 * Import from here rather than from the individual service files: this module
 * registers all four, and cross-service cascades (a payment funding a
 * milestone, a milestone completing a contract) depend on that.
 *
 * Callers:
 *   - HTTP routes, always as a HUMAN actor built from the session;
 *   - the AI tool layer, as an AI_AGENT actor (`ai/tools/lifecycle-tools.ts`);
 *   - server-side jobs and the payment webhook handler, as SYSTEM / WEBHOOK.
 */

import { type Db, prisma } from '../../lib/db/client';
import { CONTRACT_LIFECYCLE } from './contract-lifecycle';
import { type TransitionOutcome, type TransitionRequest, executeTransition, registerLifecycleSpec } from './engine';
import { MILESTONE_LIFECYCLE } from './milestone-lifecycle';
import { PAYMENT_LIFECYCLE } from './payment-lifecycle';
import { PROJECT_LIFECYCLE } from './project-lifecycle';

registerLifecycleSpec(PROJECT_LIFECYCLE);
registerLifecycleSpec(CONTRACT_LIFECYCLE);
registerLifecycleSpec(MILESTONE_LIFECYCLE);
registerLifecycleSpec(PAYMENT_LIFECYCLE);

export function transitionProject(request: TransitionRequest, db: Db = prisma): Promise<TransitionOutcome> {
  return executeTransition(PROJECT_LIFECYCLE, request, db);
}

export function transitionContract(request: TransitionRequest, db: Db = prisma): Promise<TransitionOutcome> {
  return executeTransition(CONTRACT_LIFECYCLE, request, db);
}

export function transitionMilestone(request: TransitionRequest, db: Db = prisma): Promise<TransitionOutcome> {
  return executeTransition(MILESTONE_LIFECYCLE, request, db);
}

export function transitionPayment(request: TransitionRequest, db: Db = prisma): Promise<TransitionOutcome> {
  return executeTransition(PAYMENT_LIFECYCLE, request, db);
}

export type {
  CascadeResult,
  DisputeResolution,
  LifecycleActor,
  LifecycleEntityType,
  LifecycleRejectionCode,
  Participants,
  RiskLevelInput,
  TransitionDenyReason,
  TransitionOutcome,
  TransitionParams,
  TransitionRequest,
} from './engine';
