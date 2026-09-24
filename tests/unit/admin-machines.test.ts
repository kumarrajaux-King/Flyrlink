/**
 * Phase 8 admin state machines — every (event, state) cell, every actor kind,
 * and the invariants that make each machine safe to hand to an administrator.
 */

import { describe, expect, it } from 'vitest';

import { ACCOUNT_MACHINE } from '../../domain/account/state-machine';
import {
  DISPUTE_OPEN_STATES,
  DISPUTE_RESOLVED_STATES,
  DISPUTE_TRIAGE_MACHINE,
} from '../../domain/dispute/triage-machine';
import { type ActorKind, type StateMachine, evaluateTransition, targetsOf } from '../../domain/lifecycle/machine';
import { PAYOUT_DECISION_MACHINE, PAYOUT_PROVIDER_STATES } from '../../domain/payout/decision-machine';
import { REVIEW_MODERATION_MACHINE } from '../../domain/review/moderation-machine';
import { VERIFICATION_MACHINE, verificationStage } from '../../domain/verification/state-machine';
import { scopeOf } from '../../lib/authz/roles';
import { OPEN_DISPUTE_STATUSES } from '../../services/lifecycle/engine';

type AnyMachine = StateMachine<string, string, never>;

const MACHINES: readonly (readonly [string, AnyMachine, readonly object[]])[] = [
  ['Account', ACCOUNT_MACHINE as unknown as AnyMachine, [{ emailVerified: true }, { emailVerified: false }]],
  ['Verification', VERIFICATION_MACHINE as unknown as AnyMachine, [{}]],
  ['DisputeTriage', DISPUTE_TRIAGE_MACHINE as unknown as AnyMachine, [{}]],
  ['ReviewModeration', REVIEW_MODERATION_MACHINE as unknown as AnyMachine, [{}]],
  ['PayoutDecision', PAYOUT_DECISION_MACHINE as unknown as AnyMachine, [{}]],
];

const NON_HUMAN: readonly ActorKind[] = ['AI_AGENT', 'SYSTEM', 'WEBHOOK'];

describe.each(MACHINES)('%s machine', (_name, machine, contexts) => {
  it('admits only humans holding a platform-authority grant', () => {
    for (const transition of machine.transitions) {
      expect(transition.actors, transition.event).toEqual(['HUMAN']);
      expect(transition.permissions?.length, transition.event).toBeGreaterThan(0);
      expect(transition.permissions!.every((permission) => scopeOf(permission) === 'any'), transition.event).toBe(true);
    }
  });

  it('declares unique events over its own states, with no exit from a terminal state', () => {
    const events = machine.transitions.map((transition) => transition.event);
    expect(new Set(events).size).toBe(events.length);

    for (const transition of machine.transitions) {
      for (const state of [...transition.from, ...targetsOf(transition)]) {
        expect(machine.states, `${transition.event} → ${state}`).toContain(state);
      }
      for (const terminal of machine.terminal) {
        expect(transition.from, `${transition.event} leaves terminal ${terminal}`).not.toContain(terminal);
      }
    }
  });

  it('refuses AI agents, SYSTEM and WEBHOOK callers for every event from every state', () => {
    for (const transition of machine.transitions) {
      for (const state of machine.states) {
        for (const context of contexts) {
          for (const kind of NON_HUMAN) {
            expect(evaluateTransition(machine, state, transition.event, kind, context as never)).toMatchObject({
              kind: 'REJECTED',
              code: kind === 'AI_AGENT' ? 'AI_NOT_PERMITTED' : 'ACTOR_NOT_PERMITTED',
            });
          }
        }
      }
    }
  });

  it('evaluates every (event, state) cell for a human: valid, repeat, or invalid', () => {
    let cells = 0;
    for (const transition of machine.transitions) {
      for (const state of machine.states) {
        for (const context of contexts) {
          const target = transition.resolveTo ? transition.resolveTo(context as never) : transition.to;
          const result = evaluateTransition(machine, state, transition.event, 'HUMAN', context as never);
          cells += 1;

          if (target !== undefined && state === target) {
            expect(result.kind, `${transition.event} from ${state}`).toBe('NO_OP');
          } else if (!transition.from.includes(state)) {
            expect(result, `${transition.event} from ${state}`).toMatchObject({ kind: 'REJECTED', code: 'INVALID_TRANSITION' });
          } else {
            expect(result, `${transition.event} from ${state}`).toMatchObject({ kind: 'VALID', from: state, to: target });
          }
        }
      }
    }
    expect(cells).toBe(machine.transitions.length * machine.states.length * contexts.length);
  });

  it('rejects an event it does not define', () => {
    expect(evaluateTransition(machine, machine.initial, 'TELEPORT', 'HUMAN', contexts[0] as never)).toMatchObject({
      kind: 'REJECTED',
      code: 'UNKNOWN_EVENT',
    });
  });
});

describe('account machine', () => {
  it('reinstates to ACTIVE only for an account that verified its email', () => {
    expect(evaluateTransition(ACCOUNT_MACHINE, 'SUSPENDED', 'REINSTATE', 'HUMAN', { emailVerified: true })).toMatchObject({
      kind: 'VALID',
      to: 'ACTIVE',
    });
    expect(evaluateTransition(ACCOUNT_MACHINE, 'SUSPENDED', 'REINSTATE', 'HUMAN', { emailVerified: false })).toMatchObject({
      kind: 'VALID',
      to: 'PENDING_VERIFICATION',
    });
  });

  it('cannot suspend a deactivated account, and both events are high risk', () => {
    expect(evaluateTransition(ACCOUNT_MACHINE, 'DEACTIVATED', 'SUSPEND', 'HUMAN', { emailVerified: true })).toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(ACCOUNT_MACHINE.transitions.every((transition) => transition.risk === 'HIGH')).toBe(true);
  });
});

describe('verification machine', () => {
  it('reaches VERIFIED only by APPROVE, from IN_REVIEW', () => {
    const toVerified = VERIFICATION_MACHINE.transitions.filter((transition) => targetsOf(transition).includes('VERIFIED'));
    expect(toVerified.map((transition) => [transition.event, transition.from])).toEqual([['APPROVE', ['IN_REVIEW']]]);
  });

  it('treats every decision as at least MEDIUM risk, and grants and withdrawals as HIGH', () => {
    const risk = Object.fromEntries(VERIFICATION_MACHINE.transitions.map((transition) => [transition.event, transition.risk]));
    expect(risk).toEqual({
      START_REVIEW: 'LOW',
      REQUEST_INFORMATION: 'MEDIUM',
      APPROVE: 'HIGH',
      REJECT: 'HIGH',
      REVOKE: 'HIGH',
    });
  });

  it('derives the workflow stage from status and review timing', () => {
    const submittedAt = new Date('2026-09-01T10:00:00Z');
    expect(verificationStage({ status: 'PENDING', submittedAt, reviewedAt: null })).toBe('AWAITING_REVIEW');
    expect(verificationStage({ status: 'PENDING', submittedAt, reviewedAt: new Date('2026-08-30T00:00:00Z') })).toBe(
      'AWAITING_REVIEW',
    );
    expect(verificationStage({ status: 'PENDING', submittedAt, reviewedAt: submittedAt })).toBe('AWAITING_EXPERT');
    expect(verificationStage({ status: 'PENDING', submittedAt, reviewedAt: new Date('2026-09-02T00:00:00Z') })).toBe(
      'AWAITING_EXPERT',
    );
    expect(verificationStage({ status: 'IN_REVIEW', submittedAt, reviewedAt: null })).toBe('IN_REVIEW');
    for (const status of ['VERIFIED', 'REJECTED', 'REVOKED', 'EXPIRED']) {
      expect(verificationStage({ status, submittedAt, reviewedAt: submittedAt })).toBe('DECIDED');
    }
  });
});

describe('dispute triage machine', () => {
  it('can never resolve a dispute — resolution belongs to the lifecycle', () => {
    for (const transition of DISPUTE_TRIAGE_MACHINE.transitions) {
      for (const target of targetsOf(transition)) {
        expect(DISPUTE_RESOLVED_STATES, transition.event).not.toContain(target);
      }
    }
  });

  it('agrees with the lifecycle engine on which disputes are open', () => {
    expect([...DISPUTE_OPEN_STATES].sort()).toEqual([...OPEN_DISPUTE_STATUSES].sort());
  });
});

describe('review moderation machine', () => {
  it('never acts on a PENDING review and never leaves REJECTED', () => {
    for (const transition of REVIEW_MODERATION_MACHINE.transitions) {
      expect(transition.from, transition.event).not.toContain('PENDING');
      expect(transition.from, transition.event).not.toContain('REJECTED');
    }
  });
});

describe('payout decision machine', () => {
  it('cannot produce or leave a provider-attested state', () => {
    for (const transition of PAYOUT_DECISION_MACHINE.transitions) {
      for (const state of PAYOUT_PROVIDER_STATES) {
        expect(targetsOf(transition), transition.event).not.toContain(state);
        expect(transition.from, transition.event).not.toContain(state);
      }
    }
  });

  it('marks every decision financial, approval CRITICAL, and makes a released hold need approval again', () => {
    expect(PAYOUT_DECISION_MACHINE.transitions.every((transition) => transition.financial)).toBe(true);
    const byEvent = Object.fromEntries(PAYOUT_DECISION_MACHINE.transitions.map((transition) => [transition.event, transition]));
    expect(byEvent.APPROVE?.risk).toBe('CRITICAL');
    expect(byEvent.RELEASE_HOLD?.to).toBe('PENDING_APPROVAL');
  });
});
