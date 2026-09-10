import { describe, expect, it } from 'vitest';

import {
  assignRoleSchema,
  changePasswordSchema,
  enrollMfaSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  toFieldErrors,
  verifyEmailSchema,
  verifyMfaSchema,
} from '../../lib/validation/auth';

const validRegistration = {
  email: 'Person@Example.TEST',
  password: 'correct horse battery staple',
  fullName: '  Nina Customer  ',
  accountType: 'CUSTOMER' as const,
  acceptedTerms: true as const,
};

describe('registerSchema', () => {
  it('accepts a valid registration and normalises input', () => {
    const result = registerSchema.safeParse(validRegistration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('person@example.test'); // lowercased
      expect(result.data.fullName).toBe('Nina Customer'); // trimmed
    }
  });

  it('rejects an unknown field — a client cannot smuggle privileged state', () => {
    // This is the important one: without strictObject, `role` or `status` could
    // ride along into a create call.
    for (const extra of [
      { role: 'SUPER_ADMIN' },
      { status: 'ACTIVE' },
      { emailVerified: new Date().toISOString() },
      { isAdmin: true },
    ]) {
      const result = registerSchema.safeParse({ ...validRegistration, ...extra });
      expect(result.success, `should reject ${JSON.stringify(extra)}`).toBe(false);
    }
  });

  it('offers no role field at all', () => {
    expect(Object.keys(registerSchema.shape)).not.toContain('role');
    expect(Object.keys(registerSchema.shape)).not.toContain('roles');
  });

  it('restricts accountType to the two self-service roles', () => {
    for (const accountType of ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'nonsense']) {
      const result = registerSchema.safeParse({ ...validRegistration, accountType });
      expect(result.success, `should reject accountType=${accountType}`).toBe(false);
    }
    expect(registerSchema.safeParse({ ...validRegistration, accountType: 'EXPERT' }).success)
      .toBe(true);
  });

  it('requires terms acceptance to be literally true', () => {
    expect(registerSchema.safeParse({ ...validRegistration, acceptedTerms: false }).success)
      .toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, acceptedTerms: 'yes' }).success)
      .toBe(false);
  });

  it('rejects malformed emails', () => {
    for (const email of ['', 'nope', 'a@', '@b.test', 'a b@c.test', `${'x'.repeat(250)}@y.test`]) {
      expect(registerSchema.safeParse({ ...validRegistration, email }).success, email).toBe(false);
    }
  });

  it('enforces the password policy', () => {
    expect(registerSchema.safeParse({ ...validRegistration, password: 'short' }).success)
      .toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, password: 'x'.repeat(300) }).success)
      .toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts any non-empty password so legacy credentials remain checkable', () => {
    const result = loginSchema.safeParse({ email: 'a@b.test', password: 'short' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty password and unknown fields', () => {
    expect(loginSchema.safeParse({ email: 'a@b.test', password: '' }).success).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'a@b.test', password: 'x', totp: '123456' }).success,
    ).toBe(false);
  });
});

describe('token-bearing schemas', () => {
  const token = 'A'.repeat(43);

  it('accepts a well-formed opaque token', () => {
    expect(verifyEmailSchema.safeParse({ token }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token, password: 'correct horse battery' }).success)
      .toBe(true);
  });

  it('rejects tokens that are too short, too long, or wrongly encoded', () => {
    for (const bad of ['', 'abc', 'x'.repeat(500), 'has spaces here!!', 'plus+slash/chars=']) {
      expect(verifyEmailSchema.safeParse({ token: bad }).success, bad.slice(0, 20)).toBe(false);
    }
  });

  it('still enforces the password policy on reset', () => {
    expect(resetPasswordSchema.safeParse({ token, password: 'short' }).success).toBe(false);
  });
});

describe('MFA schemas', () => {
  it('requires a 6-digit code for enrollment', () => {
    expect(enrollMfaSchema.safeParse({ code: '123456' }).success).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      expect(enrollMfaSchema.safeParse({ code }).success, code).toBe(false);
    }
  });

  it('accepts exactly one of code or backupCode', () => {
    expect(verifyMfaSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(verifyMfaSchema.safeParse({ backupCode: 'ABCDE-FGHJK' }).success).toBe(true);
    // Neither, or both, is a malformed challenge response.
    expect(verifyMfaSchema.safeParse({}).success).toBe(false);
    expect(verifyMfaSchema.safeParse({ code: '123456', backupCode: 'ABCDE-FGHJK' }).success)
      .toBe(false);
  });
});

describe('assignRoleSchema', () => {
  it('requires a UUIDv7 user id and a known role', () => {
    const ok = assignRoleSchema.safeParse({
      userId: '018f4f4e-0000-7000-8000-00000000c001',
      role: 'FINANCE',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a non-UUID id and an unknown role', () => {
    expect(assignRoleSchema.safeParse({ userId: '42', role: 'FINANCE' }).success).toBe(false);
    expect(
      assignRoleSchema.safeParse({
        userId: '018f4f4e-0000-7000-8000-00000000c001',
        role: 'GOD_MODE',
      }).success,
    ).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('requires the current password and a policy-compliant new one', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'correct horse batt' })
        .success,
    ).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success)
      .toBe(false);
  });
});

describe('toFieldErrors', () => {
  it('keys messages by field path for the API error envelope', () => {
    const result = registerSchema.safeParse({
      email: 'nope',
      password: 'short',
      fullName: 'A',
      accountType: 'CUSTOMER',
      acceptedTerms: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(['email', 'fullName', 'password']);
      expect(errors.email?.[0]).toBeTypeOf('string');
    }
  });

  it('groups form-level issues under an underscore key', () => {
    const result = verifyMfaSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(toFieldErrors(result.error))).toContain('_');
    }
  });
});

describe('requestPasswordResetSchema', () => {
  it('takes only an email', () => {
    expect(requestPasswordResetSchema.safeParse({ email: 'a@b.test' }).success).toBe(true);
    expect(requestPasswordResetSchema.safeParse({ email: 'a@b.test', userId: 'x' }).success)
      .toBe(false);
  });
});
