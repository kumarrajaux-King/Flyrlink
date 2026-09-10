/**
 * Opaque token generation and storage hashing.
 *
 * Used for session tokens, email-verification tokens, password-reset tokens and
 * MFA backup codes.
 *
 * SECURITY MODEL
 *   The raw token is shown to the client exactly once (in a cookie or a link).
 *   Only its SHA-256 hash is stored. A database leak therefore does not hand an
 *   attacker usable sessions or reset links — which is the whole point, and the
 *   reason `Session.sessionToken` and `VerificationToken.tokenHash` hold digests
 *   rather than the tokens themselves.
 *
 *   SHA-256 (not Argon2) is correct here: these tokens are 256 bits of CSPRNG
 *   output, so they are not brute-forceable and need no key stretching. Lookup
 *   must also be fast and indexable.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes = 256 bits of entropy. */
const TOKEN_BYTES = 32;

/** Generate a URL-safe opaque token. Return value is the RAW token — store only its hash. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Hash a raw token for storage or lookup. Deterministic, so it can be indexed. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Compare two token hashes without leaking their difference through timing.
 *
 * Prefer looking a token up by its hash (an indexed equality match) — this is
 * for the cases where two hashes are already in hand.
 */
export function tokensMatch(hashA: string, hashB: string): boolean {
  const a = Buffer.from(hashA, 'utf8');
  const b = Buffer.from(hashB, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A freshly minted token: the raw value to send, and the hash to persist. */
export interface IssuedToken {
  readonly raw: string;
  readonly hash: string;
}

export function issueToken(): IssuedToken {
  const raw = generateToken();
  return { raw, hash: hashToken(raw) };
}

// ---------------------------------------------------------------- expiry

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
export const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30; // 30 minutes — deliberately short
export const MFA_ENROLLMENT_TTL_MS = 1000 * 60 * 10; // 10 minutes

export function expiresAt(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}

export function isExpired(expiry: Date, now: Date = new Date()): boolean {
  return expiry.getTime() <= now.getTime();
}

// ---------------------------------------------------------------- backup codes

/** Number of single-use MFA backup codes issued at enrollment. */
export const BACKUP_CODE_COUNT = 10;

/**
 * Human-transcribable backup codes. Crockford-style alphabet with the
 * ambiguous characters (I, L, O, U, 0, 1) removed, so a code read off paper
 * cannot be mistyped into a different valid code.
 */
const BACKUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const BACKUP_CODE_LENGTH = 10;

function randomBackupCode(): string {
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const chars: string[] = [];
  const limit = Math.floor(256 / BACKUP_ALPHABET.length) * BACKUP_ALPHABET.length;
  while (chars.length < BACKUP_CODE_LENGTH) {
    for (const byte of randomBytes(BACKUP_CODE_LENGTH)) {
      if (byte >= limit) continue;
      chars.push(BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length]!);
      if (chars.length === BACKUP_CODE_LENGTH) break;
    }
  }
  // Grouped for legibility: XXXXX-XXXXX
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export interface BackupCodes {
  /** Show these to the user once, then discard. */
  readonly raw: readonly string[];
  /** Persist these. Each is single-use: delete on redemption. */
  readonly hashes: readonly string[];
}

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): BackupCodes {
  const raw: string[] = [];
  while (raw.length < count) {
    const code = randomBackupCode();
    if (!raw.includes(code)) raw.push(code);
  }
  return { raw, hashes: raw.map((code) => hashToken(normalizeBackupCode(code))) };
}

/** Accept a code the user typed with different casing, spaces or missing dashes. */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}
