/**
 * Password hashing — Argon2id.
 *
 * STEP 02 §13 mandates Argon2id. Parameters follow OWASP guidance for Argon2id
 * (>= 19 MiB memory, >= 2 iterations); we use 64 MiB / t=3 / p=4.
 *
 * SECURITY NOTES
 *   - Plaintext passwords are never logged, never stored, never returned.
 *   - `verifyPassword` is written so that a non-existent user costs the same
 *     wall-clock time as a wrong password, closing the timing side-channel that
 *     would otherwise let an attacker enumerate registered email addresses.
 *   - `needsRehash` lets us transparently upgrade stored hashes when we raise
 *     the cost parameters later, without forcing a password reset.
 */

import argon2 from 'argon2';

/** Argon2id cost parameters. Raising these is safe; `needsRehash` migrates users on next login. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * Minimum length. Deliberately length-based rather than composition-based:
 * composition rules ("one symbol, one digit") measurably reduce entropy in
 * practice by pushing users toward predictable patterns.
 */
export const PASSWORD_MIN_LENGTH = 12;
/** Argon2 handles long inputs, but an unbounded field is a cheap DoS vector. */
export const PASSWORD_MAX_LENGTH = 256;

/**
 * A pre-computed hash of a value no user can have, used to burn an equivalent
 * amount of CPU when the account does not exist. Generated lazily once.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(
    'account-does-not-exist::timing-equalizer',
    ARGON2_OPTIONS,
  );
  return dummyHashPromise;
}

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

/** Throws `PasswordPolicyError` if the password fails policy. */
export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

/** Hash a password for storage. Enforces policy first. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against a stored hash.
 *
 * Pass `null`/`undefined` as `storedHash` when the account does not exist or has
 * no password set (OAuth-only account). The call still performs a full Argon2
 * verification against a dummy hash and returns `false`, so response time does
 * not reveal whether the account exists.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!storedHash) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    return false;
  }

  try {
    return await argon2.verify(storedHash, password);
  } catch {
    // A malformed or unrecognised hash is a verification failure, not a crash.
    return false;
  }
}

/** True when a stored hash was produced with weaker parameters than current policy. */
export function needsRehash(storedHash: string): boolean {
  try {
    return argon2.needsRehash(storedHash, ARGON2_OPTIONS);
  } catch {
    // Unparseable hash — treat as needing a rehash so it gets replaced.
    return true;
  }
}
