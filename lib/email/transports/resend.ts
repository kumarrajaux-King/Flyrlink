/**
 * Resend, over its REST API.
 *
 * WHY NO SDK
 *   Sending an email is one POST with a JSON body. An SDK for that is a
 *   dependency, a supply-chain surface and a version to keep current, in the
 *   most security-sensitive path in the product, in exchange for nothing. The
 *   request below is the whole integration.
 *
 * WHAT IS NEVER LOGGED OR THROWN
 *   The API key. It appears exactly once, in the Authorization header, and no
 *   error path here interpolates the header, the config, or the request object
 *   into a message. Provider errors carry the provider's own text, which
 *   describes the request shape rather than its credentials.
 *
 *   Message bodies are not logged either: a verification link is a bearer
 *   token, and a log line holding one is an account takeover waiting for
 *   whoever reads the logs.
 */

import type { EmailConfig } from '../config';
import { type DeliveryResult, EmailDeliveryError, type EmailMessage, type EmailTransport } from '../transport';

const ENDPOINT = 'https://api.resend.com/emails';

/** A slow provider must not hold an HTTP request open indefinitely. */
const TIMEOUT_MS = 10_000;

type ResendConfig = Extract<EmailConfig, { provider: 'resend' }>;

interface ResendSuccess {
  readonly id?: string;
}

interface ResendFailure {
  readonly message?: string;
  readonly name?: string;
}

export function createResendTransport(config: ResendConfig): EmailTransport {
  return {
    name: 'resend',
    delivers: true,

    async send(message: EmailMessage): Promise<DeliveryResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
            ...(message.tag ? { tags: [{ name: 'kind', value: message.tag }] } : {}),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        // A network failure, a DNS failure, a blocked egress, or the timeout.
        // `error.message` here is Node's, not ours, and holds no credential.
        const reason = error instanceof Error ? error.message : 'unknown network failure';
        throw new EmailDeliveryError('resend', `Could not reach the mail provider: ${reason}`);
      } finally {
        clearTimeout(timer);
      }

      const body = (await response.json().catch(() => ({}))) as ResendSuccess & ResendFailure;

      if (!response.ok) {
        // The provider's own description. Common ones worth recognising:
        //   401  the key is wrong or revoked
        //   403  the sending domain is not verified
        //   422  the `from` address is not one this account may use
        //   429  rate limited
        throw new EmailDeliveryError(
          'resend',
          body.message ?? `Provider refused the message (HTTP ${response.status}).`,
          response.status,
        );
      }

      return { status: 'SENT', transport: 'resend', messageId: body.id ?? null };
    },
  };
}
