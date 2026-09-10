/**
 * The policy engine.
 *
 * STEP 02 §11.3:
 *
 *   AGENT → POLICY ENGINE → PERMISSION CHECK → RISK CLASSIFICATION
 *         → HUMAN APPROVAL (if required) → ACTION → AUDIT LOG
 *
 * Every tool call an agent proposes passes through `evaluate` before anything
 * executes. The function is pure, so all of its branches are unit-testable.
 *
 * Two properties matter most:
 *
 *   1. **It fails closed.** An unknown tool, a tool the agent is not allow-listed
 *      for, or a missing actor all DENY. There is no default-allow path.
 *   2. **The acting identity is the human's, never the agent's.** Permissions are
 *      checked against the user who triggered the run, so an agent can never
 *      exceed the authority of the person it is acting for. This is also what
 *      makes prompt injection ineffective: text an agent read cannot grant
 *      permissions its user does not hold.
 */

import { type Actor, authorize } from '../../lib/authz/authorize';
import { type Permission } from '../../lib/authz/roles';
import { type ForbiddenMatch, matchForbiddenCapability } from './forbidden';

export type AiRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PolicyEffect = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export type PolicyDenyCode =
  | 'NO_ACTOR'
  | 'UNKNOWN_TOOL'
  | 'FORBIDDEN_CAPABILITY'
  | 'TOOL_NOT_ALLOWED_FOR_AGENT'
  | 'AGENT_DISABLED'
  | 'MISSING_PERMISSION'
  | 'MFA_REQUIRED'
  | 'ACCOUNT_INACTIVE';

export type PolicyDecision =
  | { readonly effect: 'ALLOW'; readonly reason: string }
  | {
      readonly effect: 'REQUIRE_APPROVAL';
      readonly reason: string;
      /** CRITICAL actions additionally require a SUPER_ADMIN approver. */
      readonly requiresSuperAdmin: boolean;
    }
  | { readonly effect: 'DENY'; readonly reason: string; readonly code: PolicyDenyCode };

/** What the engine needs to know about the tool being proposed. */
export interface PolicyToolDescriptor {
  readonly name: string;
  readonly riskTier: AiRiskTier;
  readonly requiredPermission: Permission;
}

export interface PolicyContext {
  /** The human on whose behalf the agent is running. Never the agent itself. */
  readonly actor: Actor | null;
  /** Tools this agent version is allow-listed to use. */
  readonly agentAllowedTools: readonly string[];
  readonly agentEnabled: boolean;
  /** Resolves a tool name to its descriptor, or undefined when unknown. */
  readonly lookupTool: (name: string) => PolicyToolDescriptor | undefined;
}

function deny(code: PolicyDenyCode, reason: string): PolicyDecision {
  return { effect: 'DENY', reason, code };
}

/**
 * Decide what happens to a proposed tool call.
 *
 * Check order is deliberate: existence and legality of the tool first (cheap,
 * and the most serious failures), then agent scope, then the human's
 * permissions, then risk tier.
 */
export function evaluate(toolName: string, context: PolicyContext): PolicyDecision {
  if (!context.agentEnabled) {
    return deny('AGENT_DISABLED', 'This agent is disabled.');
  }

  const tool = context.lookupTool(toolName);
  if (!tool) {
    // Fails closed: a hallucinated tool name is a denial, not a no-op.
    return deny('UNKNOWN_TOOL', `No tool named "${toolName}" is registered.`);
  }

  // Defence in depth — registration should already have rejected this.
  const forbidden: ForbiddenMatch | null = matchForbiddenCapability(tool.name);
  if (forbidden) {
    return deny(
      'FORBIDDEN_CAPABILITY',
      `"${tool.name}" implies the forbidden capability "${forbidden.capability}".`,
    );
  }

  if (!context.agentAllowedTools.includes(tool.name)) {
    return deny(
      'TOOL_NOT_ALLOWED_FOR_AGENT',
      `This agent is not allow-listed to use "${tool.name}".`,
    );
  }

  if (!context.actor) {
    return deny('NO_ACTOR', 'No acting user is attached to this run.');
  }

  // The human's permissions, not the agent's. `:any`-scoped tool permissions are
  // used deliberately: per-resource ownership is enforced inside each tool
  // handler, which is the only place the resource is actually loaded.
  const authorization = authorize(context.actor, tool.requiredPermission);
  if (!authorization.allowed) {
    switch (authorization.reason) {
      case 'MFA_REQUIRED':
        return deny('MFA_REQUIRED', 'The acting user has not satisfied MFA.');
      case 'ACCOUNT_INACTIVE':
        return deny('ACCOUNT_INACTIVE', 'The acting user account is not active.');
      default:
        return deny(
          'MISSING_PERMISSION',
          `The acting user lacks "${tool.requiredPermission}".`,
        );
    }
  }

  switch (tool.riskTier) {
    case 'LOW':
      return { effect: 'ALLOW', reason: 'Read-only or inconsequential.' };
    case 'MEDIUM':
      return { effect: 'ALLOW', reason: 'Creates a draft or non-binding record.' };
    case 'HIGH':
      return {
        effect: 'REQUIRE_APPROVAL',
        reason: 'Has commercial, trust or contractual effect. A human must approve it.',
        requiresSuperAdmin: false,
      };
    case 'CRITICAL':
      return {
        effect: 'REQUIRE_APPROVAL',
        reason: 'Financial or account-level effect. A super administrator must approve it.',
        requiresSuperAdmin: true,
      };
    default:
      // Unreachable given the union, but an unknown tier must never fall through
      // to allow.
      return deny('UNKNOWN_TOOL', 'Unrecognised risk tier.');
  }
}

/** Maps a decision to the `AiAction.status` it should be persisted with. */
export function statusForDecision(
  decision: PolicyDecision,
): 'AUTO_APPROVED' | 'PENDING_APPROVAL' | 'REJECTED' {
  switch (decision.effect) {
    case 'ALLOW':
      return 'AUTO_APPROVED';
    case 'REQUIRE_APPROVAL':
      return 'PENDING_APPROVAL';
    case 'DENY':
      return 'REJECTED';
  }
}
