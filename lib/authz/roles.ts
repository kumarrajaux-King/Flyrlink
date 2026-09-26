/**
 * Roles and permissions.
 *
 * This is the single source of truth for what each role may do. It is pure data
 * plus pure functions — no I/O — so it is exhaustively unit-testable, which
 * matters because STEP 02 §16 names permission checks as a highest-value test
 * target.
 *
 * The `RoleName` union mirrors the `RoleName` Postgres enum from STEP 3. A test
 * asserts the two stay in sync against the real database, so drift cannot pass
 * silently.
 */

export const ROLE_NAMES = [
  'CUSTOMER',
  'EXPERT',
  'ADMIN',
  'SUPER_ADMIN',
  'SUPPORT',
  'FINANCE',
  'VERIFICATION_MANAGER',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Permissions are `domain:action:scope`.
 *
 * `own` means the actor must be a participant in the specific resource;
 * `any` means platform-wide authority. Encoding scope in the permission is what
 * lets `authorize()` decide mechanically whether an ownership check is required,
 * instead of each call site remembering to do it.
 */
export const PERMISSIONS = [
  // Projects
  'project:create:own',
  'project:read:own',
  'project:read:any',
  'project:update:own',
  'project:update:any',
  'project:submit:own',
  'project:cancel:own',
  'project:assign:any',
  // Talent
  'expert:read:any',
  'expert:update:own',
  'expert:verify:any',
  'expert:suspend:any',
  'service:create:own',
  'service:update:own',
  'service:read:any',
  'application:create:own',
  'application:read:own',
  'application:read:any',
  // The invited expert accepts or declines an assignment (project
  // ASSIGNMENT_PENDING). Required by the approved lifecycle; added in Phase 6.
  'assignment:respond:own',
  // Customers
  'customer:read:own',
  'customer:read:any',
  'customer:suspend:any',
  // Contracts
  'contract:create:own',
  'contract:read:own',
  'contract:read:any',
  'contract:accept:own',
  'contract:terminate:any',
  // Milestones & delivery
  'milestone:read:own',
  'milestone:read:any',
  'milestone:fund:own',
  'milestone:submit:own',
  'milestone:approve:own',
  'milestone:approve:any',
  'deliverable:create:own',
  'deliverable:read:own',
  'deliverable:review:own',
  'timeentry:create:own',
  'timeentry:approve:own',
  // Money
  'payment:create:own',
  'payment:read:own',
  'payment:read:any',
  'refund:request:own',
  'refund:approve:any',
  'payout:read:own',
  'payout:read:any',
  'payout:approve:any',
  'payout:process:any',
  'commission:read:any',
  'commission:configure:any',
  'ledger:read:any',
  // Reputation
  'review:create:own',
  'review:read:any',
  'review:moderate:any',
  // Collaboration
  'message:create:own',
  'message:read:own',
  'message:read:any',
  // Disputes & support
  'dispute:create:own',
  'dispute:read:own',
  'dispute:read:any',
  'dispute:resolve:any',
  'ticket:read:any',
  'ticket:respond:any',
  // AI
  'ai:run:own',
  'ai:read:any',
  'ai:approve:any',
  // Platform
  'user:read:any',
  'user:role:assign:any',
  'user:suspend:any',
  'audit:read:any',
  'config:read:any',
  'config:update:any',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER_PERMISSIONS: readonly Permission[] = [
  'project:create:own',
  'project:read:own',
  'project:update:own',
  'project:submit:own',
  'project:cancel:own',
  'expert:read:any',
  'service:read:any',
  'application:read:own',
  'customer:read:own',
  'contract:create:own',
  'contract:read:own',
  'contract:accept:own',
  'milestone:read:own',
  'milestone:fund:own',
  'milestone:approve:own',
  'deliverable:read:own',
  'deliverable:review:own',
  'timeentry:approve:own',
  'payment:create:own',
  'payment:read:own',
  'refund:request:own',
  'review:create:own',
  'review:read:any',
  'message:create:own',
  'message:read:own',
  'dispute:create:own',
  'dispute:read:own',
  'ai:run:own',
];

const EXPERT_PERMISSIONS: readonly Permission[] = [
  'project:read:own',
  'expert:update:own',
  'expert:read:any',
  'service:create:own',
  'service:update:own',
  'service:read:any',
  'application:create:own',
  'application:read:own',
  'assignment:respond:own',
  'contract:read:own',
  // The expert countersigns the contract offered to them (Phase 6, approved).
  'contract:accept:own',
  'milestone:read:own',
  'milestone:submit:own',
  'deliverable:create:own',
  'deliverable:read:own',
  'timeentry:create:own',
  'payout:read:own',
  'review:create:own',
  'review:read:any',
  'message:create:own',
  'message:read:own',
  'dispute:create:own',
  'dispute:read:own',
  'ai:run:own',
];

/**
 * Operational management, but deliberately NOT financial configuration or role
 * assignment — those stay with SUPER_ADMIN so that day-to-day admin access
 * cannot escalate itself or change the platform's economics.
 */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  'project:read:any',
  'project:update:any',
  'project:assign:any',
  'expert:read:any',
  'expert:suspend:any',
  'service:read:any',
  'application:read:any',
  'customer:read:any',
  'customer:suspend:any',
  'contract:read:any',
  'contract:terminate:any',
  'milestone:read:any',
  'milestone:approve:any',
  'payment:read:any',
  'payout:read:any',
  'commission:read:any',
  'review:read:any',
  'review:moderate:any',
  'message:read:any',
  'dispute:read:any',
  'dispute:resolve:any',
  'ticket:read:any',
  'ticket:respond:any',
  'ai:read:any',
  'ai:approve:any',
  'user:read:any',
  'user:suspend:any',
  'audit:read:any',
  'config:read:any',
];

const SUPPORT_PERMISSIONS: readonly Permission[] = [
  'project:read:any',
  'expert:read:any',
  'service:read:any',
  'customer:read:any',
  'contract:read:any',
  'milestone:read:any',
  'message:read:any',
  'review:read:any',
  'dispute:read:any',
  'ticket:read:any',
  'ticket:respond:any',
  'user:read:any',
];

const FINANCE_PERMISSIONS: readonly Permission[] = [
  'project:read:any',
  'contract:read:any',
  'milestone:read:any',
  'payment:read:any',
  'refund:approve:any',
  'payout:read:any',
  'payout:approve:any',
  'payout:process:any',
  'commission:read:any',
  'commission:configure:any',
  'ledger:read:any',
  'audit:read:any',
  'config:read:any',
];

const VERIFICATION_MANAGER_PERMISSIONS: readonly Permission[] = [
  'expert:read:any',
  'expert:verify:any',
  'user:read:any',
  'audit:read:any',
];

export const ROLE_PERMISSIONS: Readonly<Record<RoleName, readonly Permission[]>> = {
  CUSTOMER: CUSTOMER_PERMISSIONS,
  EXPERT: EXPERT_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  SUPPORT: SUPPORT_PERMISSIONS,
  FINANCE: FINANCE_PERMISSIONS,
  VERIFICATION_MANAGER: VERIFICATION_MANAGER_PERMISSIONS,
  // Full authority. Kept as the complete list rather than a wildcard so that
  // "who can do X" is answerable by inspecting data, not by special-casing.
  SUPER_ADMIN: PERMISSIONS,
};

/** Roles that carry platform-wide authority and are audited more strictly. */
export const PRIVILEGED_ROLES: readonly RoleName[] = [
  'ADMIN',
  'SUPER_ADMIN',
  'SUPPORT',
  'FINANCE',
  'VERIFICATION_MANAGER',
];

/**
 * Roles that MUST satisfy MFA before any privileged action.
 *
 * STEP 02 §13 named ADMIN, SUPER_ADMIN and FINANCE. VERIFICATION_MANAGER was
 * added at the Phase 8 review (open decision A-08): verification is a trust
 * boundary, and granting or withdrawing a verified badge is a HIGH-risk
 * decision, so it should not be made from a session that never passed a second
 * factor. SUPPORT stays outside the gate: it is read-mostly and decides
 * nothing.
 */
export const MFA_REQUIRED_ROLES: readonly RoleName[] = [
  'ADMIN',
  'SUPER_ADMIN',
  'FINANCE',
  'VERIFICATION_MANAGER',
];

/** Actions so consequential they require SUPER_ADMIN, per STEP 02 §11.3 (CRITICAL tier). */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  'user:role:assign:any',
  'commission:configure:any',
  'config:update:any',
];

export function isPrivilegedRole(role: RoleName): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

export function requiresMfa(roles: readonly RoleName[]): boolean {
  return roles.some((role) => MFA_REQUIRED_ROLES.includes(role));
}

/**
 * Whether a session counts as having satisfied MFA.
 *
 * The session row carries a `mfaSatisfied` flag, but for a role in the required
 * set that flag is not enough on its own: an account that never enrolled a
 * second factor has nothing to satisfy, so a naive "the user has no MFA, so
 * there is nothing to wait for" reading hands it a fully-cleared privileged
 * session. That is precisely the hole this function closes — an MFA-required
 * role must have **enrolled** a factor *and* cleared it on *this* session.
 *
 * Derived on every request rather than trusted from the row, so granting
 * somebody ADMIN does not leave their existing session privileged-and-cleared
 * until it happens to be revoked.
 */
export function mfaSatisfiedForSession(params: {
  readonly roles: readonly RoleName[];
  /** Whether the account has a second factor enrolled at all. */
  readonly mfaEnrolled: boolean;
  /** The flag stored on the session row. */
  readonly sessionMfaSatisfied: boolean;
}): boolean {
  if (!requiresMfa(params.roles)) return params.sessionMfaSatisfied;
  return params.mfaEnrolled && params.sessionMfaSatisfied;
}

/** All permissions granted by a set of roles, de-duplicated. */
export function permissionsForRoles(roles: readonly RoleName[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }
  return granted;
}

/** Scope encoded in a permission string. */
export function scopeOf(permission: Permission): 'own' | 'any' {
  return permission.endsWith(':any') ? 'any' : 'own';
}
