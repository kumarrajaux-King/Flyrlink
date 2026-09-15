/**
 * Transition authorization — pure, so every branch is unit-testable.
 *
 * A lifecycle event lists RBAC alternatives; holding any one suffices. An
 * `:any` grant is platform authority and passes regardless of party. An `:own`
 * grant needs the human to be a participant — and, when the event names a
 * party, to be on that side of the engagement. The party rule is what stops a
 * customer from accepting their own contract offer, even though both sides
 * hold `contract:accept:own`.
 *
 * The decision itself is `authorize()` from STEP 4, unchanged. This module only
 * decides which resource context each alternative is checked against.
 */

import { type Actor, type DenyReason, type ResourceParticipants, authorize } from '../../lib/authz/authorize';
import { scopeOf } from '../../lib/authz/roles';
import type { TransitionDefinition } from '../../domain/lifecycle/machine';

/** Who is connected to an entity, for :own permissions and party checks. */
export interface Participants {
  readonly customerUserId: string | null;
  readonly expertUserIds: readonly string[];
}

export type TransitionDenyReason = DenyReason | 'WRONG_PARTY';

export type TransitionAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: TransitionDenyReason };

type AuthorizableDefinition = Pick<TransitionDefinition<string, string, never>, 'permissions' | 'party'>;

/** On refusal, the most specific reason is reported. */
const DENY_SPECIFICITY: Record<TransitionDenyReason, number> = {
  NOT_AUTHENTICATED: 7,
  ACCOUNT_INACTIVE: 6,
  MFA_REQUIRED: 5,
  SUPER_ADMIN_REQUIRED: 4,
  WRONG_PARTY: 3,
  NOT_A_PARTICIPANT: 2,
  MISSING_PERMISSION: 1,
  RESOURCE_CONTEXT_REQUIRED: 0,
};

function resourceFor(definition: AuthorizableDefinition, participants: Participants): ResourceParticipants {
  switch (definition.party) {
    case 'CUSTOMER':
      return { customerUserId: participants.customerUserId };
    case 'EXPERT':
      return { participantUserIds: participants.expertUserIds };
    default:
      return {
        customerUserId: participants.customerUserId,
        participantUserIds: participants.expertUserIds,
      };
  }
}

/** Authorize a human for one transition. An event with no permissions admits no human. */
export function authorizeForTransition(
  actor: Actor,
  definition: AuthorizableDefinition,
  participants: Participants,
): TransitionAuthorization {
  let best: TransitionDenyReason = 'MISSING_PERMISSION';

  for (const permission of definition.permissions ?? []) {
    const resource = scopeOf(permission) === 'own' ? resourceFor(definition, participants) : undefined;
    const result = authorize(actor, permission, resource);
    if (result.allowed) return { allowed: true };

    let reason: TransitionDenyReason = result.reason;
    if (reason === 'NOT_A_PARTICIPANT' && definition.party) {
      // A participant on the other side hears WRONG_PARTY, which says what is
      // actually wrong, rather than "not a participant", which is untrue.
      const onOtherSide =
        definition.party === 'CUSTOMER'
          ? participants.expertUserIds.includes(actor.userId)
          : participants.customerUserId === actor.userId;
      if (onOtherSide) reason = 'WRONG_PARTY';
    }
    if (DENY_SPECIFICITY[reason] > DENY_SPECIFICITY[best]) best = reason;
  }

  return { allowed: false, reason: best };
}

export function denialMessage(reason: TransitionDenyReason, party: string | undefined): string {
  switch (reason) {
    case 'WRONG_PARTY':
      return `Only the ${(party ?? 'other party').toLowerCase()} may perform this transition.`;
    case 'NOT_A_PARTICIPANT':
      return 'You are not a participant in this record.';
    case 'MFA_REQUIRED':
      return 'Complete multi-factor authentication to perform this transition.';
    case 'ACCOUNT_INACTIVE':
      return 'This account is not active.';
    case 'SUPER_ADMIN_REQUIRED':
      return 'This transition requires a super administrator.';
    default:
      return 'Your role does not permit this transition.';
  }
}
