/**
 * What every email transport must be able to do, and what it must tell us.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *   A transport reports what actually happened. There is no "assume it went" —
 *   `DeliveryResult` makes "sent" and "not sent" different values, so a caller
 *   cannot accidentally treat a no-op as a delivery, and a log line or a
 *   diagnostic can always say which one it was.
 *
 *   The previous implementation had no transport at all: `sendAuthEmail` either
 *   threw or wrote a line to the server console. Nothing in the application had
 *   ever opened a socket to a mail provider, and nothing in the response or the
 *   UI distinguished that from a successful send. That is the failure this
 *   type is shaped to prevent.
 */

/** A rendered message, ready for any provider. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Always present. Some clients never render the HTML, and some people prefer not to. */
  readonly text: string;
  readonly html: string;
  /** Groups a provider's logs; not shown to the recipient. */
  readonly tag?: string;
}

export type DeliveryResult =
  | {
      readonly status: 'SENT';
      readonly transport: string;
      /** The provider's own id, for looking the message up in their dashboard. */
      readonly messageId: string | null;
    }
  | {
      readonly status: 'NOT_SENT';
      readonly transport: string;
      /** Why. Safe to log and to show an operator; never contains a secret. */
      readonly reason: string;
    };

export interface EmailTransport {
  /** Short, stable name — appears in `DeliveryResult` and in diagnostics. */
  readonly name: string;
  /** True only for a transport that really hands mail to a provider. */
  readonly delivers: boolean;
  send(message: EmailMessage): Promise<DeliveryResult>;
}

/**
 * Raised when a provider was configured, was asked to send, and refused.
 *
 * Distinct from `NOT_SENT`, which is the ordinary "there is no provider here"
 * answer. This is a provider that exists and said no — a bad key, an
 * unverified sender, a rate limit — and the caller usually wants it to surface
 * rather than be swallowed.
 */
export class EmailDeliveryError extends Error {
  readonly transport: string;
  readonly statusCode: number | null;

  constructor(transport: string, message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.transport = transport;
    this.statusCode = statusCode;
  }
}
