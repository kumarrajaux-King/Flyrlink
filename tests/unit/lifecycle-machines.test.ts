/**
 * Lifecycle state machine unit tests — Phase 6.
 *
 * Exhaustive over the four STEP 02 §10 transition matrices. For every event:
 *
 *   - every valid source state is evaluated for every allowed actor kind, in
 *     every context its guards and dynamic targets depend on;
 *   - every other state is evaluated as an invalid source;
 *   - every actor kind the event does not list is evaluated and refused.
 *
 * Then the structural invariants the business rules depend on, conformance to
 * the STEP 02 diagrams, and the pure authorization decision.
 *
 * No database: the machines and the authorization decision are pure.
 */

import { describe, expect, it } from 'vitest';

import {
  type ActorKind,
  type Evaluation,
  InvalidTransitionError,
  type StateMachine,
  type TransitionDefinition,
  assertTransition,
  availableEvents,
  evaluateTransition,
  findTransition,
  reachableStates,
  targetsOf,
} from '../../domain/lifecycle/machine';
import {
  CONTRACT_EVENTS,
  CONTRACT_MACHINE,
  CONTRACT_STATES,
  type ContractContext,
} from '../../domain/contract/state-machine';
import { MILESTONE_EVENTS, MILESTONE_MACHINE, MILESTONE_STATES } from '../../domain/milestone/state-machine';
import {
  PAYMENT_EVENTS,
  PAYMENT_MACHINE,
  PAYMENT_STATES,
  WEBHOOK_ONLY_PAYMENT_EVENTS,
} from '../../domain/payment/state-machine';
import {
  PROJECT_ANY_STATE_EVENTS,
  PROJECT_END_STATES,
  PROJECT_EVENTS,
  PROJECT_MACHINE,
  PROJECT_STATES,
  type ProjectContext,
  type ProjectSource,
} from '../../domain/project/state-machine';
import type { Actor } from '../../lib/authz/authorize';
import { PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, type RoleName, scopeOf } from '../../lib/authz/roles';
import { type Participants, authorizeForTransition } from '../../services/lifecycle/authorization';

type Machine = StateMachine<string, string, never>;
type Definition = TransitionDefinition<string, string, never>;
type Result = Evaluation<string, string, never>;

const ACTOR_KINDS: readonly ActorKind[] = ['HUMAN', 'SYSTEM', 'WEBHOOK', 'AI_AGENT'];
const SOURCES: readonly ProjectSource[] = ['POSTED_PROJECT', 'DIRECT_HIRE', 'PREDEFINED_SERVICE'];

interface MachineCase {
  readonly name: string;
  readonly machine: Machine;
  readonly events: readonly string[];
  readonly states: readonly string[];
  /** Every context the machine's guards and dynamic targets can depend on. */
  readonly contexts: readonly unknown[];
}

const PROJECT_CONTEXTS: readonly ProjectContext[] = SOURCES.flatMap((source) => [
  { source },
  ...PROJECT_STATES.map((previousStatus) => ({ source, previousStatus })),
]);

const CONTRACT_CONTEXTS: readonly ContractContext[] = [
  {},
  ...CONTRACT_STATES.map((previousStatus) => ({ previousStatus })),
];

const PROJECT: MachineCase = {
  name: 'Project',
  machine: PROJECT_MACHINE as unknown as Machine,
  events: PROJECT_EVENTS,
  states: PROJECT_STATES,
  contexts: PROJECT_CONTEXTS,
};
const CONTRACT: MachineCase = {
  name: 'Contract',
  machine: CONTRACT_MACHINE as unknown as Machine,
  events: CONTRACT_EVENTS,
  states: CONTRACT_STATES,
  contexts: CONTRACT_CONTEXTS,
};
const MILESTONE: MachineCase = {
  name: 'Milestone',
  machine: MILESTONE_MACHINE as unknown as Machine,
  events: MILESTONE_EVENTS,
  states: MILESTONE_STATES,
  contexts: [{}],
};
const PAYMENT: MachineCase = {
  name: 'Payment',
  machine: PAYMENT_MACHINE as unknown as Machine,
  events: PAYMENT_EVENTS,
  states: PAYMENT_STATES,
  contexts: [{}],
};

const CASES: readonly MachineCase[] = [PROJECT, CONTRACT, MILESTONE, PAYMENT];

function evaluate(machine: Machine, current: string, event: string, actor: ActorKind, context: unknown): Result {
  return evaluateTransition(machine, current, event, actor, context as never);
}

function guardHolds(definition: Definition, context: unknown): boolean {
  return !definition.when || definition.when(context as never);
}

function resolvedTarget(definition: Definition, context: unknown): string | undefined {
  return definition.resolveTo ? definition.resolveTo(context as never) : definition.to;
}

function definitionOf(machineCase: MachineCase, event: string): Definition {
  const definition = findTransition(machineCase.machine, event);
  if (!definition) throw new Error(`${machineCase.name} has no event ${event}`);
  return definition;
}

// ---------------------------------------------------------------------------
// Matrix cells
// ---------------------------------------------------------------------------

interface ValidCell {
  readonly label: string;
  readonly machineCase: MachineCase;
  readonly event: string;
  readonly from: string;
  readonly actor: ActorKind;
}

interface StateCell {
  readonly label: string;
  readonly machineCase: MachineCase;
  readonly event: string;
  readonly state: string;
}

interface ActorCell {
  readonly label: string;
  readonly machineCase: MachineCase;
  readonly event: string;
  readonly actor: ActorKind;
}

function cellsFor(machineCase: MachineCase) {
  const valid: ValidCell[] = [];
  const invalid: StateCell[] = [];
  const repeat: StateCell[] = [];
  const actors: ActorCell[] = [];

  for (const definition of machineCase.machine.transitions) {
    const event = definition.event;
    for (const from of definition.from) {
      for (const actor of definition.actors) {
        valid.push({ label: `${event}: ${from} → ${targetLabel(definition)} as ${actor}`, machineCase, event, from, actor });
      }
    }
    for (const state of machineCase.states) {
      if (definition.from.includes(state)) continue;
      if (definition.to === state) {
        repeat.push({ label: `${event} in ${state} is an idempotent NO_OP`, machineCase, event, state });
      } else {
        invalid.push({ label: `${event} from ${state} is refused`, machineCase, event, state });
      }
    }
    for (const actor of ACTOR_KINDS) {
      if (!definition.actors.includes(actor)) {
        actors.push({ label: `${event} refuses ${actor}`, machineCase, event, actor });
      }
    }
  }

  return { valid, invalid, repeat, actors };
}

function targetLabel(definition: Definition): string {
  return definition.to ?? `(restored: ${targetsOf(definition).length} possible)`;
}

describe.each(CASES)('$name matrix — every cell', (machineCase) => {
  const { valid, invalid, repeat, actors } = cellsFor(machineCase);

  it.each(valid)('valid — $label', ({ event, from, actor }) => {
    const definition = definitionOf(machineCase, event);
    const reached = new Set<string>();
    let evaluated = 0;

    for (const context of machineCase.contexts) {
      const result = evaluate(machineCase.machine, from, event, actor, context);
      const target = resolvedTarget(definition, context);

      if (!guardHolds(definition, context)) {
        // The static guard (entry source) refuses in context, never silently.
        expect(result).toMatchObject({ kind: 'REJECTED', code: 'PRECONDITION_FAILED' });
        continue;
      }
      if (target === undefined) {
        // A restore with no known prior state fails closed.
        expect(result).toMatchObject({ kind: 'REJECTED', code: 'PRECONDITION_FAILED' });
        continue;
      }

      expect(result).toMatchObject({ kind: 'VALID', from, to: target });
      reached.add(target);
      evaluated += 1;
    }

    expect(evaluated, 'at least one context must satisfy the event').toBeGreaterThan(0);
    // Every declared target is reachable from this source, and nothing else is.
    expect([...reached].sort()).toEqual([...targetsOf(definition)].sort());
  });

  it.each(invalid)('invalid — $label', ({ event, state }) => {
    const definition = definitionOf(machineCase, event);
    const actor = definition.actors[0];
    if (!actor) throw new Error(`${event} lists no actor`);

    for (const context of machineCase.contexts) {
      if (!guardHolds(definition, context)) continue;
      const result = evaluate(machineCase.machine, state, event, actor, context);
      if (resolvedTarget(definition, context) === state) {
        // A dynamic target that happens to equal the current state.
        expect(result).toMatchObject({ kind: 'NO_OP', state });
      } else {
        expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_TRANSITION' });
      }
    }
  });

  it.each(repeat)('repeat — $label', ({ event, state }) => {
    const definition = definitionOf(machineCase, event);
    for (const actor of definition.actors) {
      for (const context of machineCase.contexts.filter((ctx) => guardHolds(definition, ctx))) {
        expect(evaluate(machineCase.machine, state, event, actor, context)).toMatchObject({ kind: 'NO_OP', state });
      }
    }
  });

  it.each(actors)('actor — $label', ({ event, actor }) => {
    const definition = definitionOf(machineCase, event);
    const code = actor === 'AI_AGENT' ? 'AI_NOT_PERMITTED' : 'ACTOR_NOT_PERMITTED';
    // Refused from a valid source and from the target alike: a refused caller
    // cannot use a NO_OP answer to learn the record's state.
    const probes = [...definition.from, ...targetsOf(definition)];
    for (const state of probes) {
      for (const context of machineCase.contexts) {
        expect(evaluate(machineCase.machine, state, event, actor, context)).toMatchObject({ kind: 'REJECTED', code });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe.each(CASES)('$name structure', (machineCase) => {
  const { machine, events, states } = machineCase;

  it('declares every event exactly once', () => {
    const declared = machine.transitions.map((transition) => transition.event);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...events].sort());
  });

  it('uses only declared states, and a static or a dynamic target — never both', () => {
    expect(machine.states).toEqual(states);
    for (const definition of machine.transitions) {
      for (const from of definition.from) expect(states, definition.event).toContain(from);
      for (const target of targetsOf(definition)) expect(states, definition.event).toContain(target);
      const isStatic = definition.to !== undefined;
      const isDynamic = definition.resolveTo !== undefined && (definition.possibleTargets?.length ?? 0) > 0;
      expect(isStatic !== isDynamic, `${definition.event} must be static xor dynamic`).toBe(true);
    }
  });

  it('has no self-loops', () => {
    for (const definition of machine.transitions) {
      for (const target of targetsOf(definition)) {
        expect(definition.from, `${definition.event} → ${target}`).not.toContain(target);
      }
    }
  });

  it('reaches every state from its initial state', () => {
    expect([...reachableStates(machine)].sort()).toEqual([...states].sort());
  });

  it('gives terminal states no way out, and every other state at least one', () => {
    for (const state of states) {
      const exits = machine.transitions.filter((definition) => definition.from.includes(state));
      if (machine.terminal.includes(state)) {
        expect(exits.map((exit) => exit.event), `terminal ${state}`).toEqual([]);
      } else {
        expect(exits.length, `non-terminal ${state}`).toBeGreaterThan(0);
      }
    }
  });

  it('names the permission for every event a human may fire, and only for those', () => {
    for (const definition of machine.transitions) {
      const humanReachable = definition.actors.includes('HUMAN') || definition.actors.includes('AI_AGENT');
      if (humanReachable) {
        expect(definition.permissions?.length ?? 0, definition.event).toBeGreaterThan(0);
      } else {
        expect(definition.permissions, `${definition.event} is not human-reachable`).toBeUndefined();
      }
      for (const permission of definition.permissions ?? []) {
        expect(PERMISSIONS, definition.event).toContain(permission);
      }
    }
  });

  it('can be fired by some role for every human event, and by the named party', () => {
    for (const definition of machine.transitions) {
      if (!definition.actors.includes('HUMAN')) continue;
      const permissions = definition.permissions ?? [];
      const holders = ROLE_NAMES.filter((role) => permissions.some((p) => ROLE_PERMISSIONS[role].includes(p)));
      expect(holders.length, `${definition.event} has no role that can fire it`).toBeGreaterThan(0);

      if (definition.party) {
        const own = permissions.filter((permission) => scopeOf(permission) === 'own');
        expect(own.length, `${definition.event} names a party but no :own permission`).toBeGreaterThan(0);
        const partyRole: RoleName = definition.party;
        expect(
          own.some((permission) => ROLE_PERMISSIONS[partyRole].includes(permission)),
          `${partyRole} must hold an :own permission for ${definition.event}`,
        ).toBe(true);
      }
    }
  });
});

describe('cross-machine safety invariants', () => {
  const all = CASES.flatMap((machineCase) =>
    machineCase.machine.transitions.map((definition) => ({ machine: machineCase.name, definition })),
  );

  it('opens exactly one lifecycle event to AI agents: Project.MARK_AT_RISK', () => {
    const aiEvents = all
      .filter(({ definition }) => definition.actors.includes('AI_AGENT'))
      .map(({ machine, definition }) => `${machine}.${definition.event}`);
    expect(aiEvents).toEqual(['Project.MARK_AT_RISK']);
  });

  it('never lets an AI agent fire a HIGH, CRITICAL or financial event', () => {
    for (const { machine, definition } of all) {
      if (definition.risk === 'HIGH' || definition.risk === 'CRITICAL' || definition.financial) {
        expect(definition.actors, `${machine}.${definition.event}`).not.toContain('AI_AGENT');
      }
    }
  });

  it('keeps the AI event reversible, non-financial and MEDIUM risk', () => {
    const markAtRisk = definitionOf(PROJECT, 'MARK_AT_RISK');
    expect(markAtRisk).toMatchObject({ risk: 'MEDIUM', financial: false, from: ['ACTIVE'], to: 'AT_RISK' });
    expect(definitionOf(PROJECT, 'RESOLVE_RISK')).toMatchObject({ from: ['AT_RISK'], to: 'ACTIVE' });
    expect(definitionOf(PROJECT, 'RESOLVE_RISK').actors).toContain('HUMAN');
  });

  it('accepts WEBHOOK actors only on the payment machine', () => {
    for (const { machine, definition } of all) {
      if (machine !== 'Payment') expect(definition.actors, `${machine}.${definition.event}`).not.toContain('WEBHOOK');
    }
  });

  it('lets only a webhook record what only the provider can attest to', () => {
    for (const event of WEBHOOK_ONLY_PAYMENT_EVENTS) {
      expect(definitionOf(PAYMENT, event).actors, event).toEqual(['WEBHOOK']);
    }
    for (const state of ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK']) {
      const producers = PAYMENT.machine.transitions.filter((definition) => targetsOf(definition).includes(state));
      expect(producers.length, state).toBeGreaterThan(0);
      for (const producer of producers) expect(producer.actors, `${producer.event} → ${state}`).toEqual(['WEBHOOK']);
    }
  });

  it('releases escrow only by a CRITICAL, human, finance-permission decision', () => {
    const producers = PAYMENT.machine.transitions.filter((definition) => targetsOf(definition).includes('RELEASED'));
    expect(producers.map((producer) => producer.event)).toEqual(['RELEASE']);
    expect(definitionOf(PAYMENT, 'RELEASE')).toMatchObject({
      actors: ['HUMAN'],
      permissions: ['payout:approve:any'],
      risk: 'CRITICAL',
      financial: true,
    });
  });

  it('funds work only as a SYSTEM consequence of a payment, never on request', () => {
    expect(definitionOf(MILESTONE, 'MARK_FUNDED').actors).toEqual(['SYSTEM']);
    expect(definitionOf(CONTRACT, 'MARK_FUNDED').actors).toEqual(['SYSTEM']);
    expect(definitionOf(PROJECT, 'ACTIVATE').actors).toEqual(['SYSTEM']);
  });

  it('marks every payment event financial', () => {
    for (const definition of PAYMENT.machine.transitions) expect(definition.financial, definition.event).toBe(true);
  });

  it('never lets a customer countersign: contract acceptance is the expert party', () => {
    expect(definitionOf(CONTRACT, 'ACCEPT')).toMatchObject({
      party: 'EXPERT',
      permissions: ['contract:accept:own'],
      from: ['SENT', 'NEGOTIATION'],
    });
  });
});

// ---------------------------------------------------------------------------
// STEP 02 conformance
// ---------------------------------------------------------------------------

function hasEdge(machineCase: MachineCase, from: string, to: string, contexts = machineCase.contexts): boolean {
  return machineCase.machine.transitions.some((definition) =>
    definition.actors.some((actor) =>
      contexts.some((context) => {
        const result = evaluate(machineCase.machine, from, definition.event, actor, context);
        return result.kind === 'VALID' && result.to === to;
      }),
    ),
  );
}

function chainEdges(chain: readonly string[]): [string, string][] {
  return chain.slice(1).map((state, index) => [chain[index] ?? '', state]);
}

describe('STEP 02 §10.1 — Project', () => {
  const posted: ProjectContext[] = [{ source: 'POSTED_PROJECT' }];

  it.each(
    chainEdges([
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
      'COMPLETED',
      'REVIEW_PENDING',
      'CLOSED',
    ]),
  )('main chain %s → %s', (from, to) => {
    expect(hasEdge(PROJECT, from, to, posted)).toBe(true);
  });

  it.each([
    ['ACTIVE', 'AT_RISK'],
    ['AT_RISK', 'ACTIVE'],
  ])('ACTIVE ⇄ AT_RISK: %s → %s', (from, to) => {
    expect(hasEdge(PROJECT, from, to, posted)).toBe(true);
  });

  const anyCells = (['CANCELLED', 'DISPUTED', 'SUSPENDED'] as const).flatMap((target) =>
    PROJECT_STATES.filter((state) => state !== target).map((state) => [state, target] as const),
  );

  it.each(anyCells)('any → CANCELLED | DISPUTED | SUSPENDED: %s → %s is not narrowed', (from, to) => {
    // Structurally valid for a human from every other state, for every source.
    for (const source of SOURCES) {
      const valid = PROJECT.machine.transitions.some((definition) => {
        const result = evaluate(PROJECT.machine, from, definition.event, 'HUMAN', { source });
        return result.kind === 'VALID' && result.to === to;
      });
      expect(valid, `${source}`).toBe(true);
    }
  });

  it('leaves the main flow end states only by the STEP 02 "any →" events', () => {
    for (const state of PROJECT_END_STATES) {
      const exits = PROJECT.machine.transitions.filter((definition) => definition.from.includes(state));
      for (const exit of exits) expect(PROJECT_ANY_STATE_EVENTS, `${state} via ${exit.event}`).toContain(exit.event);
    }
  });

  it.each(SOURCES)('converges at CONTRACT_PENDING from SUBMITTED for a %s project', (source) => {
    const contexts: ProjectContext[] = [{ source }];
    const seen = new Set<string>(['SUBMITTED']);
    const queue = ['SUBMITTED'];
    // Search the main flow only; the "any →" branches are not how work proceeds.
    const mainFlow = PROJECT_STATES.filter((state) => !['CANCELLED', 'DISPUTED', 'SUSPENDED'].includes(state));
    while (queue.length > 0) {
      const state = queue.shift() ?? '';
      for (const next of mainFlow) {
        if (!seen.has(next) && hasEdge(PROJECT, state, next, contexts)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.has('CONTRACT_PENDING')).toBe(true);
  });

  it('branches strictly on entry source after submission', () => {
    const at = (source: ProjectSource, event: string, from: string) =>
      evaluate(PROJECT.machine, from, event, definitionOf(PROJECT, event).actors[0] ?? 'HUMAN', { source });

    expect(at('POSTED_PROJECT', 'START_ANALYSIS', 'SUBMITTED').kind).toBe('VALID');
    expect(at('DIRECT_HIRE', 'START_ANALYSIS', 'SUBMITTED')).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(at('DIRECT_HIRE', 'INVITE_DIRECT', 'SUBMITTED').kind).toBe('VALID');
    expect(at('POSTED_PROJECT', 'INVITE_DIRECT', 'SUBMITTED')).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(at('PREDEFINED_SERVICE', 'PREPARE_SERVICE_CONTRACT', 'SUBMITTED').kind).toBe('VALID');
    expect(at('DIRECT_HIRE', 'PREPARE_SERVICE_CONTRACT', 'SUBMITTED')).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(at('POSTED_PROJECT', 'DECLINE_ASSIGNMENT', 'ASSIGNMENT_PENDING')).toMatchObject({ to: 'MATCHING' });
    expect(at('DIRECT_HIRE', 'DECLINE_ASSIGNMENT', 'ASSIGNMENT_PENDING')).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(at('DIRECT_HIRE', 'DECLINE_INVITATION', 'ASSIGNMENT_PENDING')).toMatchObject({ to: 'DRAFT' });
    expect(at('POSTED_PROJECT', 'DECLINE_INVITATION', 'ASSIGNMENT_PENDING')).toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('STEP 02 §10.2 — Contract', () => {
  it.each([
    ...chainEdges(['DRAFT', 'SENT', 'NEGOTIATION', 'ACCEPTED', 'FUNDED', 'ACTIVE', 'COMPLETED', 'CLOSED']),
    ['SENT', 'ACCEPTED'] as [string, string],
  ])('%s → %s', (from, to) => {
    expect(hasEdge(CONTRACT, from, to)).toBe(true);
  });

  it('keeps NEGOTIATION → ACCEPTED as an expert acceptance', () => {
    expect(evaluate(CONTRACT.machine, 'NEGOTIATION', 'ACCEPT', 'HUMAN', {})).toMatchObject({
      kind: 'VALID',
      to: 'ACCEPTED',
    });
  });

  it.each(['DECLINED', 'CANCELLED', 'DISPUTED', 'TERMINATED'])('reaches the %s branch', (state) => {
    expect(reachableStates(CONTRACT.machine).has(state)).toBe(true);
  });

  it('never moves signed terms back to an unsigned state', () => {
    const signed = ['ACCEPTED', 'FUNDED', 'ACTIVE', 'COMPLETED', 'CLOSED', 'DISPUTED', 'TERMINATED'];
    for (const from of signed) {
      for (const to of ['DRAFT', 'SENT', 'NEGOTIATION']) {
        expect(hasEdge(CONTRACT, from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });
});

describe('STEP 02 §10.3 — Milestone', () => {
  it.each([
    ...chainEdges(['DRAFT', 'PENDING_FUNDING', 'FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'APPROVED']),
    ['IN_REVIEW', 'REVISION_REQUESTED'] as [string, string],
    ['REVISION_REQUESTED', 'IN_PROGRESS'] as [string, string],
    ['DISPUTED', 'RESOLVED'] as [string, string],
  ])('%s → %s', (from, to) => {
    expect(hasEdge(MILESTONE, from, to)).toBe(true);
  });

  it.each(['DISPUTED', 'RESOLVED', 'CANCELLED'])('reaches the %s branch', (state) => {
    expect(reachableStates(MILESTONE.machine).has(state)).toBe(true);
  });
});

describe('STEP 02 §10.4 — Payment', () => {
  it.each(
    chainEdges(['CREATED', 'PAYMENT_INITIATED', 'PENDING', 'SUCCEEDED', 'FUNDS_ALLOCATED', 'RELEASE_PENDING', 'RELEASED']),
  )('%s → %s', (from, to) => {
    expect(hasEdge(PAYMENT, from, to)).toBe(true);
  });

  it.each(['FAILED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'])(
    'reaches the %s branch',
    (state) => {
      expect(reachableStates(PAYMENT.machine).has(state)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Evaluator semantics
// ---------------------------------------------------------------------------

describe('evaluator semantics', () => {
  it('refuses an unknown event', () => {
    expect(evaluate(PROJECT.machine, 'DRAFT', 'TELEPORT', 'HUMAN', { source: 'POSTED_PROJECT' })).toMatchObject({
      kind: 'REJECTED',
      code: 'UNKNOWN_EVENT',
    });
  });

  it('checks the entry-source guard before reporting an idempotent repeat', () => {
    expect(
      evaluate(PROJECT.machine, 'DRAFT', 'DECLINE_INVITATION', 'HUMAN', { source: 'POSTED_PROJECT' }),
    ).toMatchObject({ kind: 'REJECTED', code: 'PRECONDITION_FAILED' });
  });

  it('restores a suspended project to its recorded prior state, and fails closed without one', () => {
    expect(
      evaluate(PROJECT.machine, 'SUSPENDED', 'RESUME', 'HUMAN', { source: 'POSTED_PROJECT', previousStatus: 'ACTIVE' }),
    ).toMatchObject({ kind: 'VALID', to: 'ACTIVE' });
    expect(evaluate(PROJECT.machine, 'SUSPENDED', 'RESUME', 'HUMAN', { source: 'POSTED_PROJECT' })).toMatchObject({
      kind: 'REJECTED',
      code: 'PRECONDITION_FAILED',
    });
    expect(evaluate(PROJECT.machine, 'ACTIVE', 'RESUME', 'HUMAN', { source: 'POSTED_PROJECT' })).toMatchObject({
      kind: 'REJECTED',
      code: 'INVALID_TRANSITION',
    });
    // A repeated RESUME after it applied is a NO_OP.
    expect(
      evaluate(PROJECT.machine, 'ACTIVE', 'RESUME', 'HUMAN', { source: 'POSTED_PROJECT', previousStatus: 'ACTIVE' }),
    ).toMatchObject({ kind: 'NO_OP', state: 'ACTIVE' });
  });

  it('throws a typed error from assertTransition, and returns the decision otherwise', () => {
    expect(() => assertTransition(PAYMENT.machine, 'CREATED', 'RELEASE', 'HUMAN', {} as never)).toThrow(
      InvalidTransitionError,
    );
    try {
      assertTransition(PAYMENT.machine, 'PENDING', 'CONFIRM_SUCCEEDED', 'HUMAN', {} as never);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'ACTOR_NOT_PERMITTED', machine: 'Payment', event: 'CONFIRM_SUCCEEDED' });
    }
    expect(assertTransition(PAYMENT.machine, 'CREATED', 'INITIATE', 'HUMAN', {} as never)).toMatchObject({
      kind: 'VALID',
      to: 'PAYMENT_INITIATED',
    });
  });

  it('lists only structurally valid events for a caller kind', () => {
    expect(availableEvents(PAYMENT.machine, 'CREATED', 'HUMAN', {} as never)).toEqual(['INITIATE', 'CANCEL']);
    expect(availableEvents(PAYMENT.machine, 'PENDING', 'WEBHOOK', {} as never)).toEqual([
      'CONFIRM_SUCCEEDED',
      'MARK_FAILED',
    ]);
    expect(availableEvents(PAYMENT.machine, 'RELEASE_PENDING', 'AI_AGENT', {} as never)).toEqual([]);
    expect(availableEvents(PROJECT.machine, 'ACTIVE', 'AI_AGENT', { source: 'POSTED_PROJECT' } as never)).toEqual([
      'MARK_AT_RISK',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Authorization decision
// ---------------------------------------------------------------------------

const CUSTOMER_ID = '018f4f4e-0000-7000-8000-0000000c0001';
const EXPERT_ID = '018f4f4e-0000-7000-8000-0000000e0001';
const OUTSIDER_ID = '018f4f4e-0000-7000-8000-00000000f001';
const STAFF_ID = '018f4f4e-0000-7000-8000-00000000a001';

const PARTICIPANTS: Participants = { customerUserId: CUSTOMER_ID, expertUserIds: [EXPERT_ID] };

function person(roles: RoleName[], userId: string, overrides: Partial<Actor> = {}): Actor {
  return { userId, roles, mfaSatisfied: true, accountActive: true, ...overrides };
}

const customer = person(['CUSTOMER'], CUSTOMER_ID);
const expert = person(['EXPERT'], EXPERT_ID);
const otherCustomer = person(['CUSTOMER'], OUTSIDER_ID);
const otherExpert = person(['EXPERT'], OUTSIDER_ID);
const admin = person(['ADMIN'], STAFF_ID);
const finance = person(['FINANCE'], STAFF_ID);
const superAdmin = person(['SUPER_ADMIN'], STAFF_ID);
const support = person(['SUPPORT'], STAFF_ID);

type AuthRow = readonly [string, MachineCase, string, Actor, 'ALLOW' | string];

const AUTHORIZATION: readonly AuthRow[] = [
  // Projects
  ['customer submits own project', PROJECT, 'SUBMIT', customer, 'ALLOW'],
  ['another customer submits it', PROJECT, 'SUBMIT', otherCustomer, 'NOT_A_PARTICIPANT'],
  ['expert submits it', PROJECT, 'SUBMIT', expert, 'MISSING_PERMISSION'],
  ['customer cancels own project', PROJECT, 'CANCEL', customer, 'ALLOW'],
  ['admin cancels any project', PROJECT, 'CANCEL', admin, 'ALLOW'],
  ['admin without MFA cancels', PROJECT, 'CANCEL', { ...admin, mfaSatisfied: false }, 'MFA_REQUIRED'],
  ['expert cancels', PROJECT, 'CANCEL', expert, 'MISSING_PERMISSION'],
  ['invited expert accepts assignment', PROJECT, 'ACCEPT_ASSIGNMENT', expert, 'ALLOW'],
  ['uninvited expert accepts assignment', PROJECT, 'ACCEPT_ASSIGNMENT', otherExpert, 'NOT_A_PARTICIPANT'],
  ['customer accepts assignment', PROJECT, 'ACCEPT_ASSIGNMENT', customer, 'MISSING_PERMISSION'],
  ['admin marks at risk', PROJECT, 'MARK_AT_RISK', admin, 'ALLOW'],
  ['customer marks at risk', PROJECT, 'MARK_AT_RISK', customer, 'MISSING_PERMISSION'],
  ['support marks at risk', PROJECT, 'MARK_AT_RISK', support, 'MISSING_PERMISSION'],
  ['admin suspends', PROJECT, 'SUSPEND', admin, 'ALLOW'],
  ['admin without MFA suspends', PROJECT, 'SUSPEND', { ...admin, mfaSatisfied: false }, 'MFA_REQUIRED'],
  ['customer raises dispute', PROJECT, 'RAISE_DISPUTE', customer, 'ALLOW'],
  ['expert raises dispute', PROJECT, 'RAISE_DISPUTE', expert, 'ALLOW'],
  ['outsider raises dispute', PROJECT, 'RAISE_DISPUTE', otherCustomer, 'NOT_A_PARTICIPANT'],
  ['admin raises dispute', PROJECT, 'RAISE_DISPUTE', admin, 'MISSING_PERMISSION'],
  ['admin resolves dispute', PROJECT, 'RESOLVE_DISPUTE', admin, 'ALLOW'],
  ['customer resolves dispute', PROJECT, 'RESOLVE_DISPUTE', customer, 'MISSING_PERMISSION'],
  ['super admin fires a SYSTEM-only event', PROJECT, 'ACTIVATE', superAdmin, 'MISSING_PERMISSION'],
  ['inactive customer submits', PROJECT, 'SUBMIT', { ...customer, accountActive: false }, 'ACCOUNT_INACTIVE'],
  // Contracts
  ['customer sends contract', CONTRACT, 'SEND', customer, 'ALLOW'],
  ['expert sends contract', CONTRACT, 'SEND', expert, 'MISSING_PERMISSION'],
  ['expert accepts contract', CONTRACT, 'ACCEPT', expert, 'ALLOW'],
  ['customer accepts own offer', CONTRACT, 'ACCEPT', customer, 'WRONG_PARTY'],
  ['another expert accepts', CONTRACT, 'ACCEPT', otherExpert, 'NOT_A_PARTICIPANT'],
  ['admin accepts on the expert’s behalf', CONTRACT, 'ACCEPT', admin, 'MISSING_PERMISSION'],
  ['expert requests changes', CONTRACT, 'REQUEST_CHANGES', expert, 'ALLOW'],
  ['customer requests changes', CONTRACT, 'REQUEST_CHANGES', customer, 'ALLOW'],
  ['expert declines', CONTRACT, 'DECLINE', expert, 'ALLOW'],
  ['customer declines own offer', CONTRACT, 'DECLINE', customer, 'WRONG_PARTY'],
  ['admin terminates', CONTRACT, 'TERMINATE', admin, 'ALLOW'],
  ['customer terminates', CONTRACT, 'TERMINATE', customer, 'MISSING_PERMISSION'],
  // Milestones
  ['expert starts milestone', MILESTONE, 'START', expert, 'ALLOW'],
  ['customer starts milestone', MILESTONE, 'START', customer, 'MISSING_PERMISSION'],
  ['customer approves milestone', MILESTONE, 'APPROVE', customer, 'ALLOW'],
  ['another customer approves', MILESTONE, 'APPROVE', otherCustomer, 'NOT_A_PARTICIPANT'],
  ['expert approves own work', MILESTONE, 'APPROVE', expert, 'MISSING_PERMISSION'],
  ['admin approves milestone', MILESTONE, 'APPROVE', admin, 'ALLOW'],
  ['admin cancels funded milestone', MILESTONE, 'CANCEL_FUNDED', admin, 'ALLOW'],
  ['customer cancels funded milestone', MILESTONE, 'CANCEL_FUNDED', customer, 'MISSING_PERMISSION'],
  // Payments
  ['customer initiates payment', PAYMENT, 'INITIATE', customer, 'ALLOW'],
  ['expert initiates payment', PAYMENT, 'INITIATE', expert, 'MISSING_PERMISSION'],
  ['finance releases escrow', PAYMENT, 'RELEASE', finance, 'ALLOW'],
  ['finance without MFA releases', PAYMENT, 'RELEASE', { ...finance, mfaSatisfied: false }, 'MFA_REQUIRED'],
  ['super admin releases escrow', PAYMENT, 'RELEASE', superAdmin, 'ALLOW'],
  ['admin releases escrow', PAYMENT, 'RELEASE', admin, 'MISSING_PERMISSION'],
  ['customer releases escrow', PAYMENT, 'RELEASE', customer, 'MISSING_PERMISSION'],
  ['expert releases escrow', PAYMENT, 'RELEASE', expert, 'MISSING_PERMISSION'],
  ['customer requests refund', PAYMENT, 'REQUEST_REFUND', customer, 'ALLOW'],
  ['another customer requests refund', PAYMENT, 'REQUEST_REFUND', otherCustomer, 'NOT_A_PARTICIPANT'],
  ['finance rejects refund', PAYMENT, 'REJECT_REFUND', finance, 'ALLOW'],
  ['customer rejects refund', PAYMENT, 'REJECT_REFUND', customer, 'MISSING_PERMISSION'],
  ['super admin confirms capture', PAYMENT, 'CONFIRM_SUCCEEDED', superAdmin, 'MISSING_PERMISSION'],
  ['finance confirms capture', PAYMENT, 'CONFIRM_SUCCEEDED', finance, 'MISSING_PERMISSION'],
];

describe('transition authorization', () => {
  it.each(AUTHORIZATION)('%s', (_label, machineCase, event, actor, expected) => {
    const definition = definitionOf(machineCase, event);
    const decision = authorizeForTransition(actor, definition, PARTICIPANTS);
    if (expected === 'ALLOW') {
      expect(decision).toEqual({ allowed: true });
    } else {
      expect(decision).toEqual({ allowed: false, reason: expected });
    }
  });

  it('grants the approved Phase 6 permissions to the expert, and nothing new to anyone else', () => {
    // 70 before Phase 6, plus assignment:respond:own. (STEP-04 had recorded 78;
    // the code has always been the authority, and the docs now match it.)
    expect(PERMISSIONS).toHaveLength(71);
    expect(ROLE_PERMISSIONS.EXPERT).toContain('assignment:respond:own');
    expect(ROLE_PERMISSIONS.EXPERT).toContain('contract:accept:own');
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain('assignment:respond:own');
    const releasers = ROLE_NAMES.filter((role) => ROLE_PERMISSIONS[role].includes('payout:approve:any'));
    expect(releasers.sort()).toEqual(['FINANCE', 'SUPER_ADMIN']);
  });
});
