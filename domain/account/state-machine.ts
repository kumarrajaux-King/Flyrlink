/**
 * Account standing — the administrative suspension workflow on `User.status`
 * (Phase 8).
 *
 *   PENDING_VERIFICATION | ACTIVE → SUSPENDED → (reinstated)
 *
 * Reinstatement restores what the account had earned, not a blanket ACTIVE: an
 * account suspended before its email was verified returns to
 * PENDING_VERIFICATION. Otherwise suspending and reinstating would be a way to
 * skip email verification.
 *
 * DEACTIVATED is the account holder's own exit and has no administrative event.
 * Both events are human-only: an AI agent can never suspend or reinstate an
 * account (STEP 02 §11.3 — account suspension is always human-approved).
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const ACCOUNT_STATES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

export const ACCOUNT_EVENTS = ['SUSPEND', 'REINSTATE'] as const;

export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];

export interface AccountContext {
  /** Whether the account ever proved control of its email address. */
  readonly emailVerified: boolean;
}

type Def = TransitionDefinition<AccountState, AccountEvent, AccountContext>;

const transitions: readonly Def[] = [
  {
    event: 'SUSPEND',
    from: ['PENDING_VERIFICATION', 'ACTIVE'],
    to: 'SUSPENDED',
    actors: ['HUMAN'],
    permissions: ['user:suspend:any'],
    risk: 'HIGH',
    financial: false,
    description: 'An administrator suspends the account. Every session is revoked in the same transaction.',
  },
  {
    event: 'REINSTATE',
    from: ['SUSPENDED'],
    resolveTo: (context) => (context.emailVerified ? 'ACTIVE' : 'PENDING_VERIFICATION'),
    possibleTargets: ['ACTIVE', 'PENDING_VERIFICATION'],
    actors: ['HUMAN'],
    permissions: ['user:suspend:any'],
    risk: 'HIGH',
    financial: false,
    description:
      'Suspension lifted. The account returns to ACTIVE, or to PENDING_VERIFICATION if its email was never verified.',
  },
];

export const ACCOUNT_MACHINE: StateMachine<AccountState, AccountEvent, AccountContext> = {
  name: 'Account',
  states: ACCOUNT_STATES,
  initial: 'PENDING_VERIFICATION',
  terminal: ['DEACTIVATED'],
  transitions,
};
