import { describe, expect, it } from 'vitest';

import {
  ARGON2_OPTIONS,
  PASSWORD_MIN_LENGTH,
  PasswordPolicyError,
  assertPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../lib/auth/password';
import {
  BACKUP_CODE_COUNT,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
  expiresAt,
  generateBackupCodes,
  generateToken,
  hashToken,
  isExpired,
  issueToken,
  normalizeBackupCode,
  tokensMatch,
} from '../../lib/auth/tokens';
import {
  TOTP_PERIOD_SECONDS,
  buildTotpUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from '../../lib/auth/totp';

const VALID_PASSWORD = 'correct horse battery staple';

describe('password hashing', () => {
  it('uses Argon2id with OWASP-grade parameters', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(ARGON2_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
  });

  it('produces an argon2id hash and verifies it', async () => {
    const hash = await hashPassword(VALID_PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, VALID_PASSWORD)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(VALID_PASSWORD);
    await expect(verifyPassword(hash, 'not the password')).resolves.toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword(VALID_PASSWORD), hashPassword(VALID_PASSWORD)]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(a, VALID_PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(b, VALID_PASSWORD)).resolves.toBe(true);
  });

  it('never stores the plaintext inside the hash', async () => {
    const hash = await hashPassword(VALID_PASSWORD);
    expect(hash).not.toContain(VALID_PASSWORD);
    expect(hash).not.toContain('horse');
  });

  it('enforces the length policy', () => {
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toThrow(
      PasswordPolicyError,
    );
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MIN_LENGTH))).not.toThrow();
    expect(() => assertPasswordPolicy('x'.repeat(500))).toThrow(PasswordPolicyError);
  });

  it('returns false — never throws — for a missing hash, so unknown users behave identically', async () => {
    await expect(verifyPassword(null, VALID_PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword(undefined, VALID_PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword('', VALID_PASSWORD)).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a failure rather than crashing', async () => {
    await expect(verifyPassword('not-a-hash', VALID_PASSWORD)).resolves.toBe(false);
    await expect(verifyPassword('$argon2id$garbage', VALID_PASSWORD)).resolves.toBe(false);
  });

  it('spends comparable time on a missing hash as on a real one (no user enumeration)', async () => {
    // Guards the timing side-channel: an early `return false` for unknown users
    // would make this ratio enormous.
    const hash = await hashPassword(VALID_PASSWORD);

    const t0 = performance.now();
    await verifyPassword(hash, 'wrong password');
    const real = performance.now() - t0;

    const t1 = performance.now();
    await verifyPassword(null, 'wrong password');
    const missing = performance.now() - t1;

    expect(missing).toBeGreaterThan(real * 0.25);
  });

  it('does not ask for a rehash at current parameters', async () => {
    const hash = await hashPassword(VALID_PASSWORD);
    expect(needsRehash(hash)).toBe(false);
  });

  it('asks for a rehash on an unparseable hash', () => {
    expect(needsRehash('legacy-md5-hash')).toBe(true);
  });
});

describe('opaque tokens', () => {
  it('generates high-entropy URL-safe tokens', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes deterministically for indexed lookup', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues a raw/hash pair where the hash is not the raw value', () => {
    const { raw, hash } = issueToken();
    expect(hash).not.toBe(raw);
    expect(hashToken(raw)).toBe(hash);
  });

  it('compares hashes safely, including on length mismatch', () => {
    const a = hashToken('a');
    const b = hashToken('b');
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch(a, 'short')).toBe(false);
  });

  it('computes expiry and detects it', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiry = expiresAt(1000, now);
    expect(expiry.getTime() - now.getTime()).toBe(1000);
    expect(isExpired(expiry, now)).toBe(false);
    expect(isExpired(expiry, new Date(now.getTime() + 1000))).toBe(true);
    expect(isExpired(expiry, new Date(now.getTime() + 5000))).toBe(true);
  });

  it('gives password resets a much shorter life than sessions', () => {
    expect(PASSWORD_RESET_TTL_MS).toBeLessThan(SESSION_TTL_MS);
    expect(PASSWORD_RESET_TTL_MS).toBeLessThanOrEqual(1000 * 60 * 60);
  });
});

describe('MFA backup codes', () => {
  it('issues the configured number of distinct codes with hashes', () => {
    const { raw, hashes } = generateBackupCodes();
    expect(raw).toHaveLength(BACKUP_CODE_COUNT);
    expect(hashes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(raw).size).toBe(BACKUP_CODE_COUNT);
  });

  it('excludes visually ambiguous characters', () => {
    const { raw } = generateBackupCodes(40);
    for (const code of raw) {
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
      expect(code).not.toMatch(/[ILOU01]/);
    }
  });

  it('matches a code the user retyped with different casing or spacing', () => {
    const { raw, hashes } = generateBackupCodes();
    const typed = ` ${raw[0]!.toLowerCase().replace('-', ' ')} `;
    expect(hashes).toContain(hashToken(normalizeBackupCode(typed)));
  });

  it('stores hashes, not the codes themselves', () => {
    const { raw, hashes } = generateBackupCodes();
    for (const code of raw) {
      expect(hashes).not.toContain(code);
    }
  });
});

describe('TOTP', () => {
  it('generates a base32 secret and a scannable URI', async () => {
    const secret = await generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const uri = await buildTotpUri({ secret, label: 'user@example.test', issuer: 'Marketplace' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('Marketplace');
  });

  it('verifies a current code', async () => {
    const secret = await generateTotpSecret();
    const code = await generateTotpCode(secret);
    const result = await verifyTotpCode({ secret, code });
    expect(result.valid).toBe(true);
    expect(result.timeStep).toBeTypeOf('number');
  });

  it('rejects a wrong code', async () => {
    const secret = await generateTotpSecret();
    const result = await verifyTotpCode({ secret, code: '000000' });
    expect(result.valid).toBe(false);
    expect(result.timeStep).toBeNull();
  });

  it('rejects a code from a different secret', async () => {
    const [a, b] = await Promise.all([generateTotpSecret(), generateTotpSecret()]);
    const code = await generateTotpCode(b);
    await expect(verifyTotpCode({ secret: a, code })).resolves.toMatchObject({ valid: false });
  });

  it('rejects malformed input without consulting the secret', async () => {
    const secret = await generateTotpSecret();
    for (const code of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      await expect(verifyTotpCode({ secret, code })).resolves.toMatchObject({ valid: false });
    }
  });

  it('tolerates clock skew of one step in both directions', async () => {
    const secret = await generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);

    const previous = await generateTotpCode(secret, now - TOTP_PERIOD_SECONDS);
    const next = await generateTotpCode(secret, now + TOTP_PERIOD_SECONDS);

    await expect(verifyTotpCode({ secret, code: previous, epochSeconds: now })).resolves
      .toMatchObject({ valid: true });
    await expect(verifyTotpCode({ secret, code: next, epochSeconds: now })).resolves
      .toMatchObject({ valid: true });
  });

  it('rejects a code two steps out — the window is not unbounded', async () => {
    const secret = await generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const stale = await generateTotpCode(secret, now - TOTP_PERIOD_SECONDS * 3);
    await expect(verifyTotpCode({ secret, code: stale, epochSeconds: now })).resolves
      .toMatchObject({ valid: false });
  });

  it('rejects replay of an already-consumed time step', async () => {
    const secret = await generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const code = await generateTotpCode(secret, now);

    const first = await verifyTotpCode({ secret, code, epochSeconds: now });
    expect(first.valid).toBe(true);

    const replay = await verifyTotpCode({
      secret,
      code,
      epochSeconds: now,
      lastUsedTimeStep: first.timeStep,
    });
    expect(replay.valid).toBe(false);
  });

  it('accepts a newer code after a previous step was consumed', async () => {
    const secret = await generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const consumedStep = Math.floor((now - TOTP_PERIOD_SECONDS) / TOTP_PERIOD_SECONDS);
    const code = await generateTotpCode(secret, now);

    await expect(
      verifyTotpCode({ secret, code, epochSeconds: now, lastUsedTimeStep: consumedStep }),
    ).resolves.toMatchObject({ valid: true });
  });
});
