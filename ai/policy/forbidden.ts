/**
 * Capabilities no AI agent may ever have.
 *
 * These are NOT modelled as "high-risk tools that need approval". They are
 * modelled as **capabilities that have no tool at all**. An agent cannot request
 * a handler that does not exist, so the guarantee does not depend on the policy
 * engine being reached, on a risk tier being set correctly, or on a reviewer
 * paying attention.
 *
 * The denylist below is therefore defence in depth: a second, independent check
 * that fails loudly if someone ever adds a tool that crosses the line. A test
 * asserts the registry contains none of these.
 */

/** The business rules this file enforces, verbatim from the Phase 7 mandate. */
export const FORBIDDEN_CAPABILITIES = [
  'move money',
  'release escrow',
  'approve payouts',
  'issue refunds',
  'change commissions',
  'modify contracts',
  'permanently delete records',
  'bypass RBAC',
  'bypass verification',
  'perform irreversible financial actions',
] as const;

export type ForbiddenCapability = (typeof FORBIDDEN_CAPABILITIES)[number];

/**
 * Tool-name fragments that indicate a forbidden capability.
 *
 * Matched case-insensitively against a normalised tool name. Deliberately broad:
 * a false positive here costs a developer one rename, while a false negative
 * could cost real money.
 */
const FORBIDDEN_NAME_PATTERNS: readonly { pattern: RegExp; capability: ForbiddenCapability }[] = [
  { pattern: /release.*(escrow|funds|payment|milestone)/i, capability: 'release escrow' },
  { pattern: /(escrow|funds).*release/i, capability: 'release escrow' },
  { pattern: /transfer.*(money|funds|balance)/i, capability: 'move money' },
  { pattern: /(capture|charge|settle).*(payment|card|customer)/i, capability: 'move money' },
  { pattern: /approve.*payout/i, capability: 'approve payouts' },
  { pattern: /(process|execute|send).*payout/i, capability: 'approve payouts' },
  { pattern: /(issue|approve|process|execute).*refund/i, capability: 'issue refunds' },
  { pattern: /refund.*(issue|approve|process|execute)/i, capability: 'issue refunds' },
  { pattern: /(update|change|set|configure).*commission/i, capability: 'change commissions' },
  { pattern: /commission.*(update|change|set|configure)/i, capability: 'change commissions' },
  { pattern: /(update|modify|amend|sign|execute|terminate).*contract/i, capability: 'modify contracts' },
  { pattern: /delete|destroy|purge|truncate|drop/i, capability: 'permanently delete records' },
  { pattern: /(grant|assign|escalate).*(role|permission)/i, capability: 'bypass RBAC' },
  { pattern: /(impersonate|sudo|as_user|bypass)/i, capability: 'bypass RBAC' },
  { pattern: /(verify|approve).*expert/i, capability: 'bypass verification' },
  { pattern: /(set|mark).*verified/i, capability: 'bypass verification' },
];

export interface ForbiddenMatch {
  readonly toolName: string;
  readonly capability: ForbiddenCapability;
  readonly pattern: string;
}

/** Returns the forbidden capability a tool name implies, or null. */
export function matchForbiddenCapability(toolName: string): ForbiddenMatch | null {
  // Normalise camelCase and snake_case so `releaseEscrow` and `release_escrow`
  // are both caught by the same pattern.
  const normalised = toolName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');

  for (const { pattern, capability } of FORBIDDEN_NAME_PATTERNS) {
    if (pattern.test(normalised)) {
      return { toolName, capability, pattern: pattern.source };
    }
  }
  return null;
}

export class ForbiddenCapabilityError extends Error {
  readonly capability: ForbiddenCapability;
  readonly toolName: string;

  constructor(match: ForbiddenMatch) {
    super(
      `Tool "${match.toolName}" implies the forbidden capability "${match.capability}". ` +
        'AI agents must never be able to perform this action. Remove the tool, or ' +
        'expose a draft/proposal-only variant that a human executes.',
    );
    this.name = 'ForbiddenCapabilityError';
    this.capability = match.capability;
    this.toolName = match.toolName;
  }
}

/** Throws if a tool name implies a forbidden capability. Called at registration. */
export function assertNotForbidden(toolName: string): void {
  const match = matchForbiddenCapability(toolName);
  if (match) throw new ForbiddenCapabilityError(match);
}
