import { describe, expect, it } from 'vitest';

import {
  type Actor,
  AuthorizationError,
  assertAuthorized,
  authorize,
  can,
  isParticipant,
} from '../../lib/authz/authorize.js';
import {
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  PRIVILEGED_ROLES,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  isPrivilegedRole,
  permissionsForRoles,
  requiresMfa,
  scopeOf,
} from '../../lib/authz/roles.js';

const CUSTOMER_ID = '018f4f4e-0000-7000-8000-00000000c001';
const EXPERT_ID = '018f4f4e-0000-7000-8000-00000000e001';
const OTHER_ID = '018f4f4e-0000-7000-8000-00000000f001';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: CUSTOMER_ID,
    roles: ['CUSTOMER'],
    mfaSatisfied: false,
    accountActive: true,
    ...overrides,
  };
}

describe('role/permission data integrity', () => {
  it('defines permissions for every role', () => {
    for (const role of ROLE_NAMES) {
      expect(ROLE_PERMISSIONS[role], `no permissions for ${role}`).toBeDefined();
      expect(ROLE_PERMISSIONS[role].length, `${role} has no permissions`).toBeGreaterThan(0);
    }
  });

  it('grants only permissions that actually exist', () => {
    const valid = new Set<string>(PERMISSIONS);
    for (const role of ROLE_NAMES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(valid.has(permission), `${role} grants unknown permission ${permission}`).toBe(true);
      }
    }
  });

  it('has no duplicate permission strings', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('gives SUPER_ADMIN every permission', () => {
    expect(new Set(ROLE_PERMISSIONS.SUPER_ADMIN).size).toBe(PERMISSIONS.length);
  });

  it('derives scope from the permission string', () => {
    expect(scopeOf('project:read:own')).toBe('own');
    expect(scopeOf('project:read:any')).toBe('any');
  });

  it('classifies privileged roles and MFA requirements', () => {
    expect(isPrivilegedRole('ADMIN')).toBe(true);
    expect(isPrivilegedRole('CUSTOMER')).toBe(false);
    expect(isPrivilegedRole('EXPERT')).toBe(false);
    expect(requiresMfa(['CUSTOMER'])).toBe(false);
    expect(requiresMfa(['CUSTOMER', 'FINANCE'])).toBe(true);
    for (const role of MFA_REQUIRED_ROLES) {
      expect(PRIVILEGED_ROLES).toContain(role);
    }
  });

  it('unions permissions across multiple roles (A-02 multi-role accounts)', () => {
    const granted = permissionsForRoles(['CUSTOMER', 'EXPERT']);
    expect(granted.has('project:create:own')).toBe(true); // customer
    expect(granted.has('deliverable:create:own')).toBe(true); // expert
    expect(granted.has('audit:read:any')).toBe(false); // neither
  });
});

describe('authorize — authentication and account standing', () => {
  it('denies an unauthenticated caller', () => {
    expect(authorize(null, 'project:read:any')).toEqual({
      allowed: false,
      reason: 'NOT_AUTHENTICATED',
    });
  });

  it('denies a suspended or unverified account even with the permission', () => {
    const suspended = actor({ roles: ['ADMIN'], mfaSatisfied: true, accountActive: false });
    expect(authorize(suspended, 'project:read:any')).toEqual({
      allowed: false,
      reason: 'ACCOUNT_INACTIVE',
    });
  });
});

describe('authorize — permission grants', () => {
  it('allows an any-scoped permission the role holds', () => {
    const admin = actor({ roles: ['ADMIN'], mfaSatisfied: true });
    expect(authorize(admin, 'project:read:any').allowed).toBe(true);
  });

  it('denies a permission the role does not hold', () => {
    expect(authorize(actor(), 'project:read:any')).toEqual({
      allowed: false,
      reason: 'MISSING_PERMISSION',
    });
  });

  it('reports MISSING_PERMISSION before MFA_REQUIRED', () => {
    // An admin lacking a finance permission should be told the permission is
    // missing, not sent to configure MFA for something they still cannot do.
    const admin = actor({ roles: ['ADMIN'], mfaSatisfied: false });
    expect(authorize(admin, 'ledger:read:any')).toEqual({
      allowed: false,
      reason: 'MISSING_PERMISSION',
    });
  });
});

describe('authorize — MFA gating (STEP 02 §13)', () => {
  it.each(MFA_REQUIRED_ROLES)('requires MFA for %s', (role) => {
    const withoutMfa = actor({ roles: [role], mfaSatisfied: false });
    const permission = ROLE_PERMISSIONS[role][0]!;
    expect(authorize(withoutMfa, permission, { ownerUserId: CUSTOMER_ID })).toEqual({
      allowed: false,
      reason: 'MFA_REQUIRED',
    });

    const withMfa = actor({ roles: [role], mfaSatisfied: true });
    expect(authorize(withMfa, permission, { ownerUserId: CUSTOMER_ID }).allowed).toBe(true);
  });

  it('does not require MFA for customers or experts', () => {
    expect(can(actor(), 'project:create:own', { customerUserId: CUSTOMER_ID })).toBe(true);
    const expert = actor({ userId: EXPERT_ID, roles: ['EXPERT'] });
    expect(can(expert, 'deliverable:create:own', { expertUserId: EXPERT_ID })).toBe(true);
  });

  it('requires MFA when a multi-role account holds any MFA-gated role', () => {
    const dual = actor({ roles: ['CUSTOMER', 'ADMIN'], mfaSatisfied: false });
    expect(authorize(dual, 'project:read:any')).toEqual({
      allowed: false,
      reason: 'MFA_REQUIRED',
    });
  });
});

describe('authorize — resource ownership (IDOR protection)', () => {
  it('fails closed when an own-scoped check omits the resource', () => {
    expect(authorize(actor(), 'project:read:own')).toEqual({
      allowed: false,
      reason: 'RESOURCE_CONTEXT_REQUIRED',
    });
  });

  it('allows a participant and denies a stranger', () => {
    const a = actor();
    expect(can(a, 'project:read:own', { customerUserId: CUSTOMER_ID })).toBe(true);
    expect(authorize(a, 'project:read:own', { customerUserId: OTHER_ID })).toEqual({
      allowed: false,
      reason: 'NOT_A_PARTICIPANT',
    });
  });

  it('recognises every participant slot', () => {
    const a = actor({ userId: OTHER_ID });
    expect(isParticipant(a, { ownerUserId: OTHER_ID })).toBe(true);
    expect(isParticipant(a, { customerUserId: OTHER_ID })).toBe(true);
    expect(isParticipant(a, { expertUserId: OTHER_ID })).toBe(true);
    expect(isParticipant(a, { participantUserIds: [CUSTOMER_ID, OTHER_ID] })).toBe(true);
    expect(isParticipant(a, { customerUserId: CUSTOMER_ID })).toBe(false);
    expect(isParticipant(a, {})).toBe(false);
  });

  it('does not treat null or undefined participants as a match', () => {
    // Guards the classic bug where an unset column equals an unset actor field.
    const a = actor({ userId: OTHER_ID });
    expect(isParticipant(a, { ownerUserId: null })).toBe(false);
    expect(isParticipant(a, { customerUserId: undefined })).toBe(false);
  });

  it('does not require ownership for an any-scoped permission', () => {
    const admin = actor({ roles: ['ADMIN'], mfaSatisfied: true });
    expect(can(admin, 'project:read:any')).toBe(true);
  });

  it("stops an expert reading another expert's work", () => {
    const expert = actor({ userId: EXPERT_ID, roles: ['EXPERT'] });
    expect(can(expert, 'milestone:read:own', { expertUserId: OTHER_ID })).toBe(false);
    expect(can(expert, 'milestone:read:own', { expertUserId: EXPERT_ID })).toBe(true);
  });
});

describe('authorize — privilege escalation protection', () => {
  it('denies role assignment to everyone except SUPER_ADMIN', () => {
    for (const role of ROLE_NAMES) {
      if (role === 'SUPER_ADMIN') continue;
      const a = actor({ roles: [role], mfaSatisfied: true });
      const result = authorize(a, 'user:role:assign:any');
      expect(result.allowed, `${role} must not assign roles`).toBe(false);
    }
    const superAdmin = actor({ roles: ['SUPER_ADMIN'], mfaSatisfied: true });
    expect(authorize(superAdmin, 'user:role:assign:any').allowed).toBe(true);
  });

  it('denies commission configuration to ADMIN and FINANCE', () => {
    const admin = actor({ roles: ['ADMIN'], mfaSatisfied: true });
    expect(authorize(admin, 'commission:configure:any')).toEqual({
      allowed: false,
      reason: 'MISSING_PERMISSION',
    });

    // FINANCE holds the permission but it is SUPER_ADMIN-gated.
    const finance = actor({ roles: ['FINANCE'], mfaSatisfied: true });
    expect(authorize(finance, 'commission:configure:any')).toEqual({
      allowed: false,
      reason: 'SUPER_ADMIN_REQUIRED',
    });
  });

  it('keeps a customer out of every :any permission', () => {
    const customer = actor();
    const anyPermissions = PERMISSIONS.filter((p) => scopeOf(p) === 'any');
    const allowedReads = new Set(['expert:read:any', 'service:read:any', 'review:read:any']);
    for (const permission of anyPermissions) {
      if (allowedReads.has(permission)) continue;
      expect(can(customer, permission), `customer must not hold ${permission}`).toBe(false);
    }
  });

  it('keeps SUPPORT read-mostly — no money movement, no verification', () => {
    const support = actor({ roles: ['SUPPORT'], mfaSatisfied: true });
    expect(can(support, 'payout:approve:any')).toBe(false);
    expect(can(support, 'refund:approve:any')).toBe(false);
    expect(can(support, 'expert:verify:any')).toBe(false);
    expect(can(support, 'dispute:resolve:any')).toBe(false);
    expect(can(support, 'ticket:respond:any')).toBe(true);
  });

  it('limits VERIFICATION_MANAGER to verification', () => {
    const verifier = actor({ roles: ['VERIFICATION_MANAGER'], mfaSatisfied: true });
    expect(can(verifier, 'expert:verify:any')).toBe(true);
    expect(can(verifier, 'payout:approve:any')).toBe(false);
    expect(can(verifier, 'project:update:any')).toBe(false);
  });

  it('lists only real permissions as SUPER_ADMIN-gated', () => {
    const valid = new Set<string>(PERMISSIONS);
    for (const permission of SUPER_ADMIN_ONLY_PERMISSIONS) {
      expect(valid.has(permission)).toBe(true);
    }
  });
});

describe('assertAuthorized / AuthorizationError', () => {
  it('throws with a reason, HTTP status and stable error code', () => {
    try {
      assertAuthorized(null, 'project:read:any');
      expect.unreachable('should have thrown');
    } catch (error) {
      const e = error as AuthorizationError;
      expect(e).toBeInstanceOf(AuthorizationError);
      expect(e.reason).toBe('NOT_AUTHENTICATED');
      expect(e.httpStatus).toBe(401);
      expect(e.errorCode).toBe('UNAUTHENTICATED');
    }
  });

  it('maps a forbidden resource to 403', () => {
    try {
      assertAuthorized(actor(), 'project:read:own', { customerUserId: OTHER_ID });
      expect.unreachable('should have thrown');
    } catch (error) {
      const e = error as AuthorizationError;
      expect(e.httpStatus).toBe(403);
      expect(e.errorCode).toBe('FORBIDDEN_RESOURCE');
    }
  });

  it('surfaces MFA_REQUIRED distinctly so the UI can prompt correctly', () => {
    try {
      assertAuthorized(actor({ roles: ['ADMIN'], mfaSatisfied: false }), 'project:read:any');
      expect.unreachable('should have thrown');
    } catch (error) {
      const e = error as AuthorizationError;
      expect(e.errorCode).toBe('MFA_REQUIRED');
      expect(e.httpStatus).toBe(403);
    }
  });

  it('does not throw when allowed', () => {
    expect(() => assertAuthorized(actor(), 'project:create:own', { customerUserId: CUSTOMER_ID }))
      .not.toThrow();
  });
});
