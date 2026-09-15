import { describe, expect, it } from 'vitest';

import type { Actor } from '../../lib/authz/authorize';
import {
  FORBIDDEN_CAPABILITIES,
  ForbiddenCapabilityError,
  assertNotForbidden,
  matchForbiddenCapability,
} from '../../ai/policy/forbidden';
import {
  type PolicyToolDescriptor,
  evaluate,
  statusForDecision,
} from '../../ai/policy/policy-engine';
import { AGENT_DEFINITIONS, agentKeys } from '../../ai/agents/definitions';
import { listTools, toolDescriptor, toolNames } from '../../ai/tools';

const USER_ID = '018f4f4e-0000-7000-8000-00000000a001';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: USER_ID,
    roles: ['ADMIN'],
    mfaSatisfied: true,
    accountActive: true,
    ...overrides,
  };
}

const lookup = (descriptors: PolicyToolDescriptor[]) => (name: string) =>
  descriptors.find((descriptor) => descriptor.name === name);

const readTool: PolicyToolDescriptor = {
  name: 'getProjectContext',
  riskTier: 'LOW',
  requiredPermission: 'project:read:any',
};
const draftTool: PolicyToolDescriptor = {
  name: 'saveProjectEstimate',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
};
const highTool: PolicyToolDescriptor = {
  name: 'createAssignmentDraft',
  riskTier: 'HIGH',
  requiredPermission: 'project:assign:any',
};
const criticalTool: PolicyToolDescriptor = {
  name: 'configurePlatformSetting',
  riskTier: 'CRITICAL',
  requiredPermission: 'config:update:any',
};

const ALL = [readTool, draftTool, highTool, criticalTool];

function context(overrides: Partial<Parameters<typeof evaluate>[1]> = {}) {
  return {
    actor: actor(),
    agentAllowedTools: ALL.map((t) => t.name),
    agentEnabled: true,
    lookupTool: lookup(ALL),
    ...overrides,
  };
}

describe('forbidden capabilities', () => {
  it('documents every capability from the Phase 7 mandate', () => {
    expect(FORBIDDEN_CAPABILITIES).toContain('move money');
    expect(FORBIDDEN_CAPABILITIES).toContain('release escrow');
    expect(FORBIDDEN_CAPABILITIES).toContain('approve payouts');
    expect(FORBIDDEN_CAPABILITIES).toContain('issue refunds');
    expect(FORBIDDEN_CAPABILITIES).toContain('change commissions');
    expect(FORBIDDEN_CAPABILITIES).toContain('modify contracts');
    expect(FORBIDDEN_CAPABILITIES).toContain('permanently delete records');
    expect(FORBIDDEN_CAPABILITIES).toContain('bypass RBAC');
    expect(FORBIDDEN_CAPABILITIES).toContain('bypass verification');
  });

  it.each([
    ['releaseEscrow', 'release escrow'],
    ['release_milestone_funds', 'release escrow'],
    ['transferFunds', 'move money'],
    ['capturePayment', 'move money'],
    ['approvePayout', 'approve payouts'],
    ['processPayout', 'approve payouts'],
    ['issueRefund', 'issue refunds'],
    ['executeRefund', 'issue refunds'],
    ['updateCommissionRule', 'change commissions'],
    ['modifyContract', 'modify contracts'],
    ['signContract', 'modify contracts'],
    ['terminateContract', 'modify contracts'],
    ['deleteProject', 'permanently delete records'],
    ['purgeAuditLog', 'permanently delete records'],
    ['assignRole', 'bypass RBAC'],
    ['impersonateUser', 'bypass RBAC'],
    ['verifyExpert', 'bypass verification'],
    ['markVerified', 'bypass verification'],
  ])('rejects the tool name %s', (name, capability) => {
    const match = matchForbiddenCapability(name);
    expect(match, `${name} should be forbidden`).not.toBeNull();
    expect(match?.capability).toBe(capability);
    expect(() => assertNotForbidden(name)).toThrow(ForbiddenCapabilityError);
  });

  it('allows legitimate draft and read tool names', () => {
    for (const name of [
      'searchExperts',
      'getProjectContext',
      'saveProjectRequirements',
      'createRecommendation',
      'createMilestoneDraft',
      'sendNotification',
      'getPaymentStatus',
    ]) {
      expect(matchForbiddenCapability(name), `${name} should be allowed`).toBeNull();
    }
  });

  it('THE safety invariant: no registered tool implies a forbidden capability', () => {
    // If this ever fails, an agent has been handed a capability the business
    // rules forbid. It is the single most important assertion in Phase 7.
    const violations = toolNames()
      .map((name) => matchForbiddenCapability(name))
      .filter((match) => match !== null);

    expect(violations, `forbidden tools registered: ${JSON.stringify(violations)}`).toEqual([]);
  });

  it('registers no tool that writes to a financial table', () => {
    // Money-moving tools do not exist at all; the read-only ones are named
    // explicitly so a new financial write tool cannot slip in unnoticed.
    const financialToolNames = toolNames().filter((name) => /payment|payout|refund|ledger|commission/i.test(name));
    expect(financialToolNames).toEqual(['getPaymentStatus']);
  });
});

describe('policy engine — fails closed', () => {
  it('denies an unknown tool', () => {
    const decision = evaluate('someHallucinatedTool', context());
    expect(decision).toMatchObject({ effect: 'DENY', code: 'UNKNOWN_TOOL' });
  });

  it('denies a tool outside the agent allow-list', () => {
    const decision = evaluate('createAssignmentDraft', context({ agentAllowedTools: ['getProjectContext'] }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'TOOL_NOT_ALLOWED_FOR_AGENT' });
  });

  it('denies when there is no acting user', () => {
    const decision = evaluate('getProjectContext', context({ actor: null }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'NO_ACTOR' });
  });

  it('denies when the agent is disabled', () => {
    const decision = evaluate('getProjectContext', context({ agentEnabled: false }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'AGENT_DISABLED' });
  });

  it('denies a forbidden capability even if someone registered it', () => {
    const rogue: PolicyToolDescriptor = {
      name: 'releaseEscrowFunds',
      riskTier: 'LOW',
      requiredPermission: 'project:read:any',
    };
    const decision = evaluate('releaseEscrowFunds', {
      ...context(),
      agentAllowedTools: ['releaseEscrowFunds'],
      lookupTool: lookup([rogue]),
    });
    // Note the tier is LOW — the capability check runs before risk, so a
    // mis-tiered dangerous tool is still refused.
    expect(decision).toMatchObject({ effect: 'DENY', code: 'FORBIDDEN_CAPABILITY' });
  });
});

describe('policy engine — permissions are the human’s', () => {
  it('denies when the acting user lacks the permission', () => {
    const customer = actor({ roles: ['CUSTOMER'], mfaSatisfied: false });
    const decision = evaluate('getProjectContext', context({ actor: customer }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'MISSING_PERMISSION' });
  });

  it('denies a privileged user who has not satisfied MFA', () => {
    const unverified = actor({ roles: ['ADMIN'], mfaSatisfied: false });
    const decision = evaluate('getProjectContext', context({ actor: unverified }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'MFA_REQUIRED' });
  });

  it('denies an inactive account', () => {
    const suspended = actor({ accountActive: false });
    const decision = evaluate('getProjectContext', context({ actor: suspended }));
    expect(decision).toMatchObject({ effect: 'DENY', code: 'ACCOUNT_INACTIVE' });
  });
});

describe('policy engine — risk tiers', () => {
  it('auto-allows LOW and MEDIUM', () => {
    expect(evaluate('getProjectContext', context()).effect).toBe('ALLOW');
    expect(evaluate('saveProjectEstimate', context()).effect).toBe('ALLOW');
  });

  it('holds HIGH for human approval', () => {
    const decision = evaluate('createAssignmentDraft', context());
    expect(decision).toMatchObject({ effect: 'REQUIRE_APPROVAL', requiresSuperAdmin: false });
  });

  it('holds CRITICAL for a super administrator', () => {
    const superAdmin = actor({ roles: ['SUPER_ADMIN'] });
    const decision = evaluate('configurePlatformSetting', context({ actor: superAdmin }));
    expect(decision).toMatchObject({ effect: 'REQUIRE_APPROVAL', requiresSuperAdmin: true });
  });

  it('never auto-approves anything above MEDIUM', () => {
    for (const tool of [highTool, criticalTool]) {
      const decision = evaluate(tool.name, context({ actor: actor({ roles: ['SUPER_ADMIN'] }) }));
      expect(decision.effect, `${tool.name} must not auto-allow`).not.toBe('ALLOW');
    }
  });

  it('maps decisions to the correct persisted status', () => {
    expect(statusForDecision({ effect: 'ALLOW', reason: '' })).toBe('AUTO_APPROVED');
    expect(
      statusForDecision({ effect: 'REQUIRE_APPROVAL', reason: '', requiresSuperAdmin: false }),
    ).toBe('PENDING_APPROVAL');
    expect(statusForDecision({ effect: 'DENY', reason: '', code: 'UNKNOWN_TOOL' })).toBe('REJECTED');
  });
});

describe('agent registry integrity', () => {
  it('defines all 13 agents', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(13);
    expect(agentKeys()).toHaveLength(13);
  });

  it('gives every agent a distinct key', () => {
    expect(new Set(AGENT_DEFINITIONS.map((a) => a.key)).size).toBe(13);
  });

  it('only allow-lists tools that are actually registered', () => {
    const registered = new Set(toolNames());
    for (const agent of AGENT_DEFINITIONS) {
      for (const tool of agent.allowedTools) {
        expect(registered, `${agent.key} references unregistered tool ${tool}`).toContain(tool);
      }
    }
  });

  it('leaves no registered tool unreachable by every agent', () => {
    // A tool no agent can call is dead code with a live handler — and the gap is
    // silent, because the policy engine simply denies it. This caught exactly
    // that: createAssignmentDraft was registered but allow-listed nowhere.
    const reachable = new Set(AGENT_DEFINITIONS.flatMap((agent) => agent.allowedTools));
    const orphaned = toolNames().filter((name) => !reachable.has(name));
    expect(orphaned, `tools no agent can use: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('keeps the payment agent read-only', () => {
    const payment = AGENT_DEFINITIONS.find((a) => a.key === 'PAYMENT')!;
    for (const toolName of payment.allowedTools) {
      const descriptor = toolDescriptor(toolName)!;
      expect(descriptor.riskTier, `${toolName} must be read-only`).toBe('LOW');
    }
  });

  it('gives the verification agent no way to grant verification', () => {
    const verification = AGENT_DEFINITIONS.find((a) => a.key === 'VERIFICATION')!;
    expect(verification.allowedTools).toEqual(['getExpertProfile']);
  });

  it('states the safety constraints in every system prompt', () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.systemPrompt, `${agent.key}`).toContain('never move money');
      expect(agent.systemPrompt, `${agent.key}`).toContain('PROPOSAL');
      expect(agent.systemPrompt, `${agent.key}`).toContain('untrusted data');
    }
  });
});

describe('lifecycle tool boundary (Phase 6)', () => {
  it('allow-lists flagProjectAtRisk to the risk agent alone', () => {
    const holders = AGENT_DEFINITIONS.filter((agent) => agent.allowedTools.includes('flagProjectAtRisk'));
    expect(holders.map((agent) => agent.key)).toEqual(['RISK']);
  });

  it('registers it as a MEDIUM, :any-gated tool that implies no forbidden capability', () => {
    expect(toolDescriptor('flagProjectAtRisk')).toEqual({
      name: 'flagProjectAtRisk',
      riskTier: 'MEDIUM',
      requiredPermission: 'project:update:any',
    });
    expect(matchForbiddenCapability('flagProjectAtRisk')).toBeNull();
  });

  it('auto-allows it only for a human who holds project:update:any', () => {
    const risk = AGENT_DEFINITIONS.find((agent) => agent.key === 'RISK')!;
    const forActor = (acting: Actor) => ({
      actor: acting,
      agentAllowedTools: risk.allowedTools,
      agentEnabled: true,
      lookupTool: toolDescriptor,
    });
    expect(evaluate('flagProjectAtRisk', forActor(actor())).effect).toBe('ALLOW');
    expect(evaluate('flagProjectAtRisk', forActor(actor({ roles: ['CUSTOMER'], mfaSatisfied: false })))).toMatchObject({
      effect: 'DENY',
      code: 'MISSING_PERMISSION',
    });
  });

  it('registers no other tool that could move a lifecycle state', () => {
    const lifecycleVerbs =
      /(submit|cancel|approve|accept|decline|release|refund|terminate|suspend|resume|activate|fund|dispute|transition|capture|allocate|complete|close|flag)/i;
    expect(toolNames().filter((name) => lifecycleVerbs.test(name))).toEqual(['flagProjectAtRisk']);
  });
});

describe('tool registry integrity', () => {
  it('declares complete metadata for every tool', () => {
    for (const tool of listTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.requiredPermission, tool.name).toMatch(/:any$/);
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(tool.riskTier);
      expect(tool.auditAction, tool.name).toMatch(/^ai\.tool\./);
      expect(typeof tool.idempotent, tool.name).toBe('boolean');
    }
  });

  it('never gates a tool on an :own-scoped permission', () => {
    // `:own` needs a resource the policy engine cannot supply, so it would
    // always deny. Per-resource scoping belongs inside the handler.
    for (const tool of listTools()) {
      expect(tool.requiredPermission.endsWith(':own'), tool.name).toBe(false);
    }
  });
});
