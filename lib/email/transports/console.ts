/**
 * The development transport. **DEV ONLY — it delivers nothing.**
 *
 * WHAT IT IS FOR
 *   Working on the signup and recovery flows without a mail provider. The link
 *   the email would have carried is written to the server console, so the flow
 *   can be walked end to end on a laptop.
 *
 * WHAT IT IS CAREFUL NOT TO DO
 *   Pretend. It returns `NOT_SENT`, and every line it prints says NOT SENT. A
 *   transport that quietly answered "sent" is how a team ships a product where
 *   nobody can verify their address — the code looks fine, the tests pass, and
 *   the first real user is the one who finds out.
 *
 *   `assertEmailReady` refuses to let this run in production, and the service
 *   refuses to use it there even if something else goes wrong.
 *
 * WHY IT PRINTS THE LINK
 *   Because the alternative is that no local developer can complete a signup,
 *   and because in development the link is for an account on a throwaway
 *   database. It is still a bearer token: this transport must never be selected
 *   anywhere that a real person's account exists.
 */

import type { DeliveryResult, EmailMessage, EmailTransport } from '../transport';

/** Pull the action link out of the plain-text part, for a readable log line. */
function firstUrl(text: string): string | null {
  return /https?:\/\/\S+/.exec(text)?.[0] ?? null;
}

export function createConsoleTransport(reason: string): EmailTransport {
  return {
    name: 'console',
    delivers: false,

    async send(message: EmailMessage): Promise<DeliveryResult> {
      const link = firstUrl(message.text);
      console.info(
        [
          '',
          '  ┌─ EMAIL NOT SENT ─ development transport ──────────────────────',
          `  │ reason   ${reason}`,
          `  │ to       ${message.to}`,
          `  │ subject  ${message.subject}`,
          ...(link ? [`  │ link     ${link}`] : []),
          '  │ Nothing was delivered. Set RESEND_API_KEY and EMAIL_FROM for real mail.',
          '  └───────────────────────────────────────────────────────────────',
          '',
        ].join('\n'),
      );

      return { status: 'NOT_SENT', transport: 'console', reason };
    },
  };
}
