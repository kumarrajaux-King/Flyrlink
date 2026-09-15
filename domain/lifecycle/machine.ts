/**
 * Generic lifecycle state-machine evaluator.
 *
 * STEP 02 §10: the backend owns every state machine, transitions are pure
 * functions, and an invalid transition is rejected rather than silently
 * ignored. This module is the pure half — no I/O, no database, no clock — so
 * every cell of every transition matrix is exhaustively unit-testable.
 *
 * A machine is a table of named **events**. Each event declares:
 *
 *   - `from`        — the states it may fire from
 *   - `to`          — the single state it produces (deterministic)
 *   - `actors`      — which kinds of caller may fire it
 *   - `permissions` — RBAC alternatives a HUMAN must hold (any one suffices)
 *   - `party`       — which side of the deal must fire it, for :own permissions
 *   - `risk`        — drives audit severity; HIGH/CRITICAL can never be AI
 *   - `financial`   — money-derived or money-affecting; never AI
 *   - `when`        — an optional context guard (e.g. project entry source)
 *
 * One event may instead declare `resolveTo` + `possibleTargets`, for the rare
 * transition whose target depends on history (resuming a suspension restores
 * the state it was suspended from). The target is still deterministic — it is a
 * pure function of the supplied context — and every possible target is declared,
 * so the matrix stays fully enumerable.
 */

import type { Permission } from '../../lib/authz/roles';

/**
 * Who is firing the transition.
 *
 *   HUMAN    — an authenticated user; RBAC and ownership apply
 *   SYSTEM   — internal code reacting to another fact (never reachable from an API)
 *   WEBHOOK  — a signature-verified payment provider event
 *   AI_AGENT — an agent acting through the controlled tool layer
 */
export type ActorKind = 'HUMAN' | 'SYSTEM' | 'WEBHOOK' | 'AI_AGENT';

export type TransitionRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Which side of the engagement must act, for :own-scoped permissions. */
export type TransitionParty = 'CUSTOMER' | 'EXPERT';

export interface TransitionDefinition<S extends string, E extends string, C> {
  readonly event: E;
  readonly from: readonly S[];
  /** Static target. Omit only when `resolveTo` is supplied. */
  readonly to?: S;
  /** Dynamic target, as a pure function of context. */
  readonly resolveTo?: (context: C) => S | undefined;
  /** Every state `resolveTo` may return. Required alongside it. */
  readonly possibleTargets?: readonly S[];
  readonly actors: readonly ActorKind[];
  /** RBAC alternatives for HUMAN actors. Omitted means no human may fire it. */
  readonly permissions?: readonly Permission[];
  readonly party?: TransitionParty;
  readonly risk: TransitionRisk;
  readonly financial: boolean;
  readonly when?: (context: C) => boolean;
  /** Human-readable reason a guard or dynamic target failed. */
  readonly whenDescription?: string;
  readonly description: string;
}

export interface StateMachine<S extends string, E extends string, C> {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: S;
  readonly terminal: readonly S[];
  readonly transitions: readonly TransitionDefinition<S, E, C>[];
}

export type RejectionCode =
  | 'UNKNOWN_EVENT'
  | 'INVALID_TRANSITION'
  | 'AI_NOT_PERMITTED'
  | 'ACTOR_NOT_PERMITTED'
  | 'PRECONDITION_FAILED';

export type Evaluation<S extends string, E extends string, C> =
  | {
      readonly kind: 'VALID';
      readonly from: S;
      readonly to: S;
      readonly definition: TransitionDefinition<S, E, C>;
    }
  | {
      /** Already in the target state: an idempotent repeat, not an error. */
      readonly kind: 'NO_OP';
      readonly state: S;
      readonly definition: TransitionDefinition<S, E, C>;
    }
  | {
      readonly kind: 'REJECTED';
      readonly code: RejectionCode;
      readonly message: string;
      readonly definition?: TransitionDefinition<S, E, C>;
    };

/** All states an event can produce — one for static events, several for dynamic. */
export function targetsOf<S extends string, E extends string, C>(
  definition: TransitionDefinition<S, E, C>,
): readonly S[] {
  if (definition.to !== undefined) return [definition.to];
  return definition.possibleTargets ?? [];
}

/** Look up an event definition by name. */
export function findTransition<S extends string, E extends string, C>(
  machine: StateMachine<S, E, C>,
  event: string,
): TransitionDefinition<S, E, C> | undefined {
  return machine.transitions.find((transition) => transition.event === event);
}

/**
 * Evaluate a proposed transition.
 *
 * Order matters and is deliberate:
 *
 *   1. unknown event                    → UNKNOWN_EVENT
 *   2. actor kind not permitted         → AI_NOT_PERMITTED / ACTOR_NOT_PERMITTED
 *   3. static context guard fails       → PRECONDITION_FAILED
 *   4. already in the target state      → NO_OP (idempotent)
 *   5. current state not a valid source → INVALID_TRANSITION
 *   6. target cannot be determined      → PRECONDITION_FAILED
 *
 * The actor check runs BEFORE the idempotency check, so an AI or a disallowed
 * actor kind cannot use a NO_OP response to probe an entity's state. RBAC for
 * humans is applied by the service before any NO_OP is returned to them.
 *
 * The `when` guard runs before NO_OP too, so an event that can never apply to
 * this entity (the wrong entry source, say) is refused rather than reported as
 * an idempotent success.
 */
export function evaluateTransition<S extends string, E extends string, C>(
  machine: StateMachine<S, E, C>,
  current: S,
  event: string,
  actorKind: ActorKind,
  context: C,
): Evaluation<S, E, C> {
  const definition = findTransition(machine, event);
  if (!definition) {
    return {
      kind: 'REJECTED',
      code: 'UNKNOWN_EVENT',
      message: `${machine.name} has no event "${event}".`,
    };
  }

  if (!definition.actors.includes(actorKind)) {
    return {
      kind: 'REJECTED',
      code: actorKind === 'AI_AGENT' ? 'AI_NOT_PERMITTED' : 'ACTOR_NOT_PERMITTED',
      message:
        actorKind === 'AI_AGENT'
          ? `AI agents may not fire ${machine.name}.${definition.event}; a human must.`
          : `${actorKind} may not fire ${machine.name}.${definition.event}.`,
      definition,
    };
  }

  if (definition.when && !definition.when(context)) {
    return {
      kind: 'REJECTED',
      code: 'PRECONDITION_FAILED',
      message:
        definition.whenDescription ??
        `${machine.name}.${definition.event} precondition not met.`,
      definition,
    };
  }

  const target = definition.resolveTo ? definition.resolveTo(context) : definition.to;

  if (target !== undefined && current === target) {
    return { kind: 'NO_OP', state: current, definition };
  }

  if (!definition.from.includes(current)) {
    return {
      kind: 'REJECTED',
      code: 'INVALID_TRANSITION',
      message: `${machine.name}.${definition.event} cannot fire from ${current}; valid from ${definition.from.join(', ')}.`,
      definition,
    };
  }

  if (target === undefined) {
    return {
      kind: 'REJECTED',
      code: 'PRECONDITION_FAILED',
      message:
        definition.whenDescription ??
        `${machine.name}.${definition.event} cannot determine its target state.`,
      definition,
    };
  }

  return { kind: 'VALID', from: current, to: target, definition };
}

/**
 * Thrown when a transition is refused. STEP 02 §10: "An invalid transition
 * throws — it is never silently ignored." Services catch it at their boundary
 * and return a typed outcome; inside a database transaction it is what rolls
 * the whole unit of work back.
 */
export class InvalidTransitionError extends Error {
  readonly code: RejectionCode;
  readonly machine: string;
  readonly event: string;

  constructor(machine: string, event: string, code: RejectionCode, message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.code = code;
    this.machine = machine;
    this.event = event;
  }
}

/** Throwing variant of `evaluateTransition` for callers that must not continue. */
export function assertTransition<S extends string, E extends string, C>(
  machine: StateMachine<S, E, C>,
  current: S,
  event: string,
  actorKind: ActorKind,
  context: C,
): Exclude<Evaluation<S, E, C>, { kind: 'REJECTED' }> {
  const evaluation = evaluateTransition(machine, current, event, actorKind, context);
  if (evaluation.kind === 'REJECTED') {
    throw new InvalidTransitionError(machine.name, event, evaluation.code, evaluation.message);
  }
  return evaluation;
}

/** Every state reachable from `initial` by following declared transitions. */
export function reachableStates<S extends string, E extends string, C>(
  machine: StateMachine<S, E, C>,
): ReadonlySet<S> {
  const seen = new Set<S>([machine.initial]);
  const queue: S[] = [machine.initial];

  while (queue.length > 0) {
    const state = queue.shift()!;
    for (const transition of machine.transitions) {
      if (!transition.from.includes(state)) continue;
      for (const target of targetsOf(transition)) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
  }
  return seen;
}

/**
 * Events that are structurally valid from a given state for a kind of caller
 * (for UI affordances). RBAC and the service's contextual rules still apply.
 */
export function availableEvents<S extends string, E extends string, C>(
  machine: StateMachine<S, E, C>,
  current: S,
  actorKind: ActorKind,
  context: C,
): readonly E[] {
  return machine.transitions
    .filter(
      (transition) =>
        evaluateTransition(machine, current, transition.event, actorKind, context).kind === 'VALID',
    )
    .map((transition) => transition.event);
}
