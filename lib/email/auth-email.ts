/**
 * Transactional auth email.
 *
 * Phase 12 wires a real provider behind this interface (STEP 02 §25 keeps every
 * provider behind an adapter). Until then the development implementation logs the
 * link so the flow is testable end to end.
 *
 * IMPORTANT
 *   Verification and reset tokens are NEVER returned in an API response. They
 *   travel only by email, because possession of the mailbox is the proof the flow
 *   depends on. Returning one to the caller would let anyone who can hit the
 *   endpoint take over an account by knowing only its email address.
 *
 *   In production with no provider configured this throws rather than silently
 *   dropping the mail — a reset flow that appears to work but sends nothing is
 *   worse than a visible failure.
 */

export type AuthEmailKind = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'DUPLICATE_REGISTRATION';

export interface AuthEmail {
  readonly to: string;
  readonly kind: AuthEmailKind;
  /** Absolute URL the recipient should open. Absent for notice-only mail. */
  readonly actionUrl?: string;
}

function isProviderConfigured(): boolean {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  if (isProviderConfigured()) {
    // Phase 12: dispatch through the configured provider adapter.
    throw new Error(
      'An email provider is configured but the adapter is not implemented until Phase 12.',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to send ${email.kind}: no email provider is configured. ` +
        'Set EMAIL_API_KEY and EMAIL_FROM, or the flow will silently fail.',
    );
  }

  // Development: log it so the link is usable without a provider.
  console.info(
    `[dev-email] ${email.kind} -> ${email.to}${email.actionUrl ? `\n  ${email.actionUrl}` : ''}`,
  );
}

/** Build an absolute app URL for an emailed link. */
export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return new URL(path, base).toString();
}
