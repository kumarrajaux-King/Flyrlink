/**
 * The email service. One way into mail for the whole application.
 *
 * WHY THE ABSTRACTION IS HERE AND NOT AT THE CALL SITES
 *   A route that imports Resend has an opinion about Resend. Four of them have
 *   four, and swapping provider then means finding all four, which is how a
 *   migration turns into an outage in the one flow nobody remembered. Callers
 *   ask for "a verification email"; which provider carries it is this module's
 *   business and nobody else's.
 *
 *     EmailService
 *       ├── sendVerificationOTP()
 *       ├── sendPasswordReset()
 *       ├── sendMFA()
 *       └── sendNotification()
 *
 * IT NEVER CLAIMS A DELIVERY IT DID NOT MAKE
 *   Every method returns a `DeliveryResult` that says SENT or NOT_SENT and
 *   which transport answered. The development transport returns NOT_SENT. A
 *   caller that wants to know can ask; a caller that does not cannot be misled
 *   into recording a send that never happened.
 *
 * IT WILL NOT RUN WITHOUT A PROVIDER IN PRODUCTION
 *   `assertEmailReady` throws at the first send on a production deployment with
 *   no provider. Verification and password reset are load-bearing — an account
 *   that cannot be verified cannot be used, and a password that cannot be reset
 *   is an account lost — so failing loudly beats discovering it one signup at a
 *   time.
 *
 * A NOTE ON THE NAME `sendVerificationOTP`
 *   This flow issues a single-use **link** carrying a 256-bit token, not a
 *   short numeric code. The method keeps the name from the approved interface;
 *   the parameters describe what is actually sent. If the flow moves to a
 *   numeric code, only `verificationMessage` and the caller change — the
 *   transport, the config and this interface do not.
 */

import { EMAIL_VERIFICATION_TTL_MS, PASSWORD_RESET_TTL_MS } from '../auth/tokens';
import { assertEmailReady, readEmailConfig } from './config';
import {
  type MfaEvent,
  duplicateRegistrationMessage,
  mfaMessage,
  notificationMessage,
  passwordResetMessage,
  verificationMessage,
} from './messages';
import { type DeliveryResult, type EmailTransport } from './transport';
import { createConsoleTransport } from './transports/console';
import { createResendTransport } from './transports/resend';

export interface EmailService {
  /** The verification link for a newly registered address. */
  sendVerificationOTP(params: { to: string; actionUrl: string }): Promise<DeliveryResult>;
  /** The password-reset link. */
  sendPasswordReset(params: { to: string; actionUrl: string }): Promise<DeliveryResult>;
  /** A security notice about the second factor. Carries no link and no code. */
  sendMFA(params: { to: string; event: MfaEvent }): Promise<DeliveryResult>;
  /** Anything else transactional. */
  sendNotification(params: {
    to: string;
    subject: string;
    heading: string;
    body: readonly string[];
    action?: { label: string; url: string } | undefined;
    tag?: string | undefined;
  }): Promise<DeliveryResult>;
  /**
   * Told to the owner of an address somebody tried to register again.
   * Registration answers identically either way, so this is the only channel
   * that reaches them.
   */
  sendDuplicateRegistrationNotice(params: { to: string }): Promise<DeliveryResult>;
  /** Which transport is in use, for diagnostics. */
  readonly transportName: string;
  /** False when nothing actually leaves this deployment. */
  readonly delivers: boolean;
}

/** Build the transport this environment is configured for. */
export function resolveTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const config = readEmailConfig(env);
  return config.provider === 'resend'
    ? createResendTransport(config)
    : createConsoleTransport(config.reason);
}

export function createEmailService(transport: EmailTransport = resolveTransport()): EmailService {
  // Guard once, at construction, so a misconfigured production deployment
  // fails at the first attempt rather than on the unluckiest one.
  assertEmailReady();

  const hours = Math.round(EMAIL_VERIFICATION_TTL_MS / 3_600_000);
  const minutes = Math.round(PASSWORD_RESET_TTL_MS / 60_000);

  return {
    transportName: transport.name,
    delivers: transport.delivers,

    sendVerificationOTP: ({ to, actionUrl }) =>
      transport.send(verificationMessage({ to, actionUrl, expiresInHours: hours })),

    sendPasswordReset: ({ to, actionUrl }) =>
      transport.send(passwordResetMessage({ to, actionUrl, expiresInMinutes: minutes })),

    sendMFA: ({ to, event }) => transport.send(mfaMessage({ to, event })),

    sendNotification: (params) => transport.send(notificationMessage(params)),

    sendDuplicateRegistrationNotice: ({ to }) => transport.send(duplicateRegistrationMessage({ to })),
  };
}

/**
 * The application's service.
 *
 * Lazy, so importing this module never reads the environment or throws — which
 * matters because `assertEmailReady` is deliberately fatal in production and
 * must fire when mail is used, not when a module graph happens to load.
 */
let cached: EmailService | null = null;

export function emailService(): EmailService {
  cached ??= createEmailService();
  return cached;
}

/** Drop the cached service. For tests, and after an environment change. */
export function resetEmailService(): void {
  cached = null;
}

/** Build an absolute app URL for an emailed link. */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return new URL(path, base).toString();
}
