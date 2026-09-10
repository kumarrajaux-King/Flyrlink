/**
 * TOTP multi-factor authentication (RFC 6238).
 *
 * STEP 02 §13 requires MFA for the privileged roles (ADMIN, SUPER_ADMIN,
 * FINANCE). This module owns secret generation, the enrollment URI, and
 * verification.
 *
 * DESIGN NOTES
 *   - A +/-1 time-step window is applied explicitly rather than relying on a
 *     library default, because otplib v13 verifies only the exact step. One step
 *     either side absorbs ordinary clock skew without materially widening the
 *     window an attacker can use.
 *   - Verification returns the matched step so the caller can persist it and
 *     reject replay of the same code within its validity window.
 */

import { generate, generateSecret, generateURI, verify } from 'otplib';

/** RFC 6238 default time step, in seconds. */
export const TOTP_PERIOD_SECONDS = 30;
/** Steps of tolerance either side of the current step. */
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_DIGITS = 6;

/** Generate a new base32 TOTP secret for enrollment. */
export async function generateTotpSecret(): Promise<string> {
  return generateSecret();
}

/**
 * Build the `otpauth://` URI an authenticator app scans.
 * `label` should identify the account (normally the user's email).
 */
export async function buildTotpUri(params: {
  secret: string;
  label: string;
  issuer: string;
}): Promise<string> {
  return String(
    await generateURI({
      secret: params.secret,
      label: params.label,
      issuer: params.issuer,
    }),
  );
}

/** Generate the code for a given secret at a given time. Exposed for tests. */
export async function generateTotpCode(secret: string, epochSeconds?: number): Promise<string> {
  return epochSeconds === undefined
    ? generate({ secret })
    : generate({ secret, epoch: epochSeconds });
}

export interface TotpVerification {
  readonly valid: boolean;
  /** Time step the code matched, for replay tracking. Null when invalid. */
  readonly timeStep: number | null;
}

/**
 * Verify a submitted code against the secret, allowing +/-`TOTP_WINDOW_STEPS`.
 *
 * `lastUsedTimeStep`, when supplied, rejects a code from a step already
 * consumed — this is what stops an intercepted code being replayed inside its
 * 30-second validity window.
 */
export async function verifyTotpCode(params: {
  secret: string;
  code: string;
  /** Override the clock. Seconds since the Unix epoch. */
  epochSeconds?: number;
  lastUsedTimeStep?: number | null;
}): Promise<TotpVerification> {
  const code = params.code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    return { valid: false, timeStep: null };
  }

  const now = params.epochSeconds ?? Math.floor(Date.now() / 1000);

  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const epoch = now + offset * TOTP_PERIOD_SECONDS;
    const result = await verify({ secret: params.secret, token: code, epoch });

    if (result.valid) {
      // Derive the step from the epoch we tested, not from the library result.
      // otplib's functional `verify` returns a TOTP|HOTP union whose members do
      // not share a step field, and we already know which epoch matched.
      const timeStep = Math.floor(epoch / TOTP_PERIOD_SECONDS);

      // Reject replay of an already-consumed step.
      if (params.lastUsedTimeStep != null && timeStep <= params.lastUsedTimeStep) {
        return { valid: false, timeStep: null };
      }
      return { valid: true, timeStep };
    }
  }

  return { valid: false, timeStep: null };
}
