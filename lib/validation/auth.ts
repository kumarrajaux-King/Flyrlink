/**
 * Zod schemas for every authentication input.
 *
 * STEP 02 §8 requires validation at every boundary with unknown fields
 * rejected — hence `z.strictObject` throughout, so a request cannot smuggle an
 * extra field (`role`, `isVerified`, `status`) into a create or update path.
 *
 * These are the single definition shared by route handlers and, later, by the
 * client forms, so client and server can never disagree about what is valid.
 */

import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password';
import { ROLE_NAMES } from '../authz/roles';

/** Normalise before validating: emails are compared case-insensitively. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address.' }))
  .refine((value) => value.length <= 254, { message: 'Email address is too long.' });

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  });

const fullName = z
  .string()
  .trim()
  .min(2, { message: 'Enter your name.' })
  .max(120, { message: 'Name is too long.' });

/** Opaque token from a cookie, link or form. base64url, 32 bytes. */
const opaqueToken = z
  .string()
  .min(20, { message: 'Invalid or expired token.' })
  .max(200, { message: 'Invalid or expired token.' })
  .regex(/^[A-Za-z0-9_-]+$/, { message: 'Invalid or expired token.' });

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { message: 'Enter the 6-digit code from your authenticator app.' });

const backupCode = z
  .string()
  .trim()
  .min(8, { message: 'Enter a valid backup code.' })
  .max(24, { message: 'Enter a valid backup code.' });

export const uuidV7 = z.uuid({ version: 'v7' });

/**
 * Registration. Note there is deliberately NO `role` field: a client can never
 * choose its own role. Registration assigns CUSTOMER or EXPERT server-side from
 * the `accountType` intent, and privileged roles are only ever granted by a
 * SUPER_ADMIN through a separate, audited path.
 */
export const registerSchema = z.strictObject({
  email,
  password,
  fullName,
  accountType: z.enum(['CUSTOMER', 'EXPERT']),
  acceptedTerms: z.literal(true, {
    message: 'You must accept the terms to create an account.',
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email,
  // Not length-validated: a login attempt against an existing weak legacy
  // password must still be checkable, and echoing policy here would leak it.
  password: z.string().min(1, { message: 'Enter your password.' }).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.strictObject({ email });
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.strictObject({
  token: opaqueToken,
  password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.strictObject({ token: opaqueToken });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.strictObject({ email });

/** Confirm TOTP enrollment by proving the user can produce a valid code. */
export const enrollMfaSchema = z.strictObject({ code: totpCode });
export type EnrollMfaInput = z.infer<typeof enrollMfaSchema>;

/** MFA challenge at login: either an authenticator code or a backup code. */
export const verifyMfaSchema = z.strictObject({
  code: totpCode.optional(),
  backupCode: backupCode.optional(),
}).refine((value) => Boolean(value.code) !== Boolean(value.backupCode), {
  message: 'Provide either an authenticator code or a backup code.',
});
export type VerifyMfaInput = z.infer<typeof verifyMfaSchema>;

export const disableMfaSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: totpCode,
});

/** Role assignment — SUPER_ADMIN only, enforced by `authorize`, not by this schema. */
export const assignRoleSchema = z.strictObject({
  userId: uuidV7,
  role: z.enum(ROLE_NAMES),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const revokeRoleSchema = assignRoleSchema;

/**
 * Flatten Zod issues into the API error envelope's `details` shape
 * (STEP 02 §8), keyed by field path so the UI can attach each message to the
 * right input.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
