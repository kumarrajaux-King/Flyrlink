/**
 * Delivery channels, behind adapters.
 *
 * Same shape and the same honesty rule as `lib/email/auth-email.ts`: in
 * development a channel logs what it would have sent, so the whole flow is
 * exercisable without a vendor account; in production an unconfigured channel
 * throws rather than reporting a delivery that never happened.
 *
 * IN_APP is the exception — it is not an external channel at all. The row in
 * `notifications` *is* the delivery, so it is complete the moment it is
 * written, and it is the only channel that cannot fail for an external reason.
 * That is why the routing rules treat it as the record of record.
 *
 * Phase 12 replaces the three external adapters with real providers. Nothing
 * outside this file needs to change when it does.
 */

import type { NotificationChannel } from '../../domain/notification/routing';

export interface ChannelPayload {
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly actionUrl: string | null;
  /** Address for the channel: an email, a phone number. Null when unknown. */
  readonly destination: string | null;
}

export class ChannelNotConfiguredError extends Error {
  readonly channel: NotificationChannel;

  constructor(channel: NotificationChannel) {
    super(`No provider is configured for the ${channel} channel.`);
    this.name = 'ChannelNotConfiguredError';
    this.channel = channel;
  }
}

export class MissingDestinationError extends Error {
  constructor(channel: NotificationChannel) {
    super(`The recipient has no address for the ${channel} channel.`);
    this.name = 'MissingDestinationError';
  }
}

interface ChannelAdapter {
  readonly channel: NotificationChannel;
  /** True when a real provider is wired up for this channel. */
  isConfigured(): boolean;
  /** Does this channel need an address on the recipient? */
  readonly needsDestination: boolean;
  send(payload: ChannelPayload): Promise<void>;
}

function developmentLog(channel: NotificationChannel, payload: ChannelPayload): void {
  console.info(
    `[dev-notify] ${channel} ${payload.type} -> ${payload.destination ?? payload.userId}\n  ${payload.title}`,
  );
}

/**
 * Shared behaviour for the external channels: refuse silently-dropped mail.
 *
 * A channel with no provider is a loud failure in production and a log line in
 * development. A recipient with no address is a failure in both — it is a data
 * problem, not an environment one, and hiding it would leave someone
 * permanently un-notified with nothing to show why.
 */
function externalAdapter(
  channel: NotificationChannel,
  isConfigured: () => boolean,
  needsDestination: boolean,
): ChannelAdapter {
  return {
    channel,
    isConfigured,
    needsDestination,
    async send(payload: ChannelPayload): Promise<void> {
      if (needsDestination && !payload.destination) {
        throw new MissingDestinationError(channel);
      }
      if (isConfigured()) {
        // Phase 12: dispatch through the configured provider adapter.
        throw new Error(`A ${channel} provider is configured but its adapter arrives in Phase 12.`);
      }
      if (process.env.NODE_ENV === 'production') {
        throw new ChannelNotConfiguredError(channel);
      }
      developmentLog(channel, payload);
    },
  };
}

const IN_APP_ADAPTER: ChannelAdapter = {
  channel: 'IN_APP',
  isConfigured: () => true,
  needsDestination: false,
  async send(): Promise<void> {
    // The notification row is the delivery. Nothing further to do.
  },
};

const ADAPTERS: Readonly<Record<NotificationChannel, ChannelAdapter>> = {
  IN_APP: IN_APP_ADAPTER,
  EMAIL: externalAdapter('EMAIL', () => Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM), true),
  SMS: externalAdapter('SMS', () => Boolean(process.env.SMS_API_KEY), true),
  WHATSAPP: externalAdapter('WHATSAPP', () => Boolean(process.env.WHATSAPP_API_KEY), true),
};

export function channelAdapter(channel: NotificationChannel): {
  readonly needsDestination: boolean;
  send(payload: ChannelPayload): Promise<void>;
} {
  return ADAPTERS[channel];
}

/** True for the one channel whose delivery is the database row itself. */
export function isImmediateChannel(channel: NotificationChannel): boolean {
  return channel === 'IN_APP';
}
