/**
 * The authorization decision function.
 *
 * STEP 02 §8: "Every read of a resource by ID passes through an authorization
 * helper that takes the actor AND the resource. There is no code path that loads
 * a resource by ID alone." This module is that helper's decision core — pure, so
 * every branch is unit-testable.
 *
 * A deny is always accompanied by a machine-readable reason, so route handlers
 * can map it to the correct HTTP status (401 vs 403 vs MFA-required) and the
 * UI can branch on a stable code rather than on prose.
 */

import {
  type Permission,
  type RoleName,
  MFA_REQUIRED_ROLES,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  permissionsForRoles,
  scopeOf,
} from './roles.js';

/** The authenticated caller. Assembled server-side from the session — never from client input. */
export interface Actor {
  readonly userId: string;
  readonly roles: readonly RoleName[];
  /** True once this session has cleared the MFA challenge. */
  readonly mfaSatisfied: boolean;
  /** A suspended or unverified account is authenticated but not authorized to act. */
  readonly accountActive: boolean;
}

/**
 * Who is connected to a resource. Any field may be absent; what matters is that
 * the caller passes what the resource actually knows, and `authorize` decides.
 */
export interface ResourceParticipants {
  /**
   * Direct owner (e.g. the user a profile belongs to).
   *
   * `undefined` is permitted alongside `null` throughout so a database row can
   * be spread in directly without the caller having to strip absent columns.
   */
  readonly ownerUserId?: string | null | undefined;
  /** Customer side of a project/contract/order. */
  readonly customerUserId?: string | null | undefined;
  /** Expert side of a project/contract/milestone. */
  readonly expertUserId?: string | null | undefined;
  /** Everyone else with legitimate access (team members, conversation members). */
  readonly participantUserIds?: readonly string[] | undefined;
}

export type DenyReason =
  | 'NOT_AUTHENTICATED'
  | 'ACCOUNT_INACTIVE'
  | 'MISSING_PERMISSION'
  | 'MFA_REQUIRED'
  | 'SUPER_ADMIN_REQUIRED'
  | 'NOT_A_PARTICIPANT'
  | 'RESOURCE_CONTEXT_REQUIRED';

export type AuthorizationResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason };

const ALLOW: AuthorizationResult = { allowed: true };

function deny(reason: DenyReason): AuthorizationResult {
  return { allowed: false, reason };
}

/** True when the actor is one of the resource's participants. */
export function isParticipant(actor: Actor, resource: ResourceParticipants): boolean {
  if (resource.ownerUserId && resource.ownerUserId === actor.userId) return true;
  if (resource.customerUserId && resource.customerUserId === actor.userId) return true;
  if (resource.expertUserId && resource.expertUserId === actor.userId) return true;
  if (resource.participantUserIds?.includes(actor.userId)) return true;
  return false;
}

/**
 * Decide whether `actor` may perform `permission`, optionally against a specific
 * resource.
 *
 * Order of checks is deliberate: authentication, then account standing, then the
 * permission grant, then MFA, then super-admin gating, then ownership. MFA is
 * checked *after* the grant so that a caller who lacks the permission entirely
 * is not told to go and set up MFA.
 *
 * For an `:own`-scoped permission, omitting `resource` is a programming error,
 * not an allow — it returns `RESOURCE_CONTEXT_REQUIRED`. This is what makes the
 * IDOR-safe pattern fail closed.
 */
export function authorize(
  actor: Actor | null,
  permission: Permission,
  resource?: ResourceParticipants,
): AuthorizationResult {
  if (!actor) return deny('NOT_AUTHENTICATED');
  if (!actor.accountActive) return deny('ACCOUNT_INACTIVE');

  const granted = permissionsForRoles(actor.roles);
  if (!granted.has(permission)) return deny('MISSING_PERMISSION');

  if (SUPER_ADMIN_ONLY_PERMISSIONS.includes(permission) && !actor.roles.includes('SUPER_ADMIN')) {
    return deny('SUPER_ADMIN_REQUIRED');
  }

  // Any role in the MFA-required set must have satisfied MFA for this session.
  if (actor.roles.some((role) => MFA_REQUIRED_ROLES.includes(role)) && !actor.mfaSatisfied) {
    return deny('MFA_REQUIRED');
  }

  if (scopeOf(permission) === 'own') {
    if (!resource) return deny('RESOURCE_CONTEXT_REQUIRED');
    if (!isParticipant(actor, resource)) return deny('NOT_A_PARTICIPANT');
  }

  return ALLOW;
}

export class AuthorizationError extends Error {
  readonly reason: DenyReason;
  readonly permission: Permission;

  constructor(reason: DenyReason, permission: Permission) {
    super(`Authorization denied (${reason}) for ${permission}`);
    this.name = 'AuthorizationError';
    this.reason = reason;
    this.permission = permission;
  }

  /** HTTP status this denial maps to. 404 is never used to mask a 403 here. */
  get httpStatus(): 401 | 403 {
    return this.reason === 'NOT_AUTHENTICATED' ? 401 : 403;
  }

  /** Stable error code for the API envelope (STEP 02 §8). */
  get errorCode(): string {
    switch (this.reason) {
      case 'NOT_AUTHENTICATED':
        return 'UNAUTHENTICATED';
      case 'MFA_REQUIRED':
        return 'MFA_REQUIRED';
      case 'ACCOUNT_INACTIVE':
        return 'ACCOUNT_INACTIVE';
      case 'SUPER_ADMIN_REQUIRED':
        return 'FORBIDDEN_SUPER_ADMIN_REQUIRED';
      default:
        return 'FORBIDDEN_RESOURCE';
    }
  }
}

/**
 * Throwing variant for use inside services, so the happy path reads linearly and
 * a missed check cannot silently continue.
 */
export function assertAuthorized(
  actor: Actor | null,
  permission: Permission,
  resource?: ResourceParticipants,
): void {
  const result = authorize(actor, permission, resource);
  if (!result.allowed) {
    throw new AuthorizationError(result.reason, permission);
  }
}

/** Non-throwing convenience for rendering decisions (hide a button, etc.). */
export function can(
  actor: Actor | null,
  permission: Permission,
  resource?: ResourceParticipants,
): boolean {
  return authorize(actor, permission, resource).allowed;
}
