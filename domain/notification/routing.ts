/**
 * Which channels a notification goes out on.
 *
 * Pure: given a type, the recipient's stored preference and a little context,
 * it returns the channels. No I/O, so the routing table is exhaustively
 * testable — which matters, because the failure modes here are asymmetric. A
 * notification sent that the user muted is an annoyance. A notification *not*
 * sent when a milestone needed their approval can stall an engagement and cost
 * someone money.
 *
 * TWO RULES SHAPE THE TABLE
 *   1. **In-app is a record, not a message.** Some notifications cannot be
 *      switched off in-app: money moved, a dispute was opened or decided, an
 *      approval is waiting on you. The user can silence the email and the SMS,
 *      but the platform will not let them arrange never to have been told that
 *      their escrow was released. Everything else is fully user-controlled.
 *   2. **Muting is per-thread, not per-type.** Muting a conversation suppresses
 *      its `MESSAGE_RECEIVED` notifications only; it never suppresses a
 *      lifecycle or financial notification that happens to relate to the same
 *      project.
 */

export const NOTIFICATION_TYPES = [
  'PROJECT_CREATED',
  'PROJECT_ANALYZED',
  'EXPERT_RECOMMENDED',
  'EXPERT_INVITED',
  'EXPERT_ACCEPTED',
  'CONTRACT_CREATED',
  'PAYMENT_SUCCESSFUL',
  'MILESTONE_FUNDED',
  'MILESTONE_DUE',
  'MILESTONE_SUBMITTED',
  'REVISION_REQUESTED',
  'MILESTONE_APPROVED',
  'PAYMENT_RELEASED',
  'PROJECT_AT_RISK',
  'PROJECT_COMPLETED',
  'REVIEW_REQUESTED',
  'PAYOUT_PROCESSED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'VERIFICATION_DECIDED',
  'AI_APPROVAL_REQUIRED',
  'MESSAGE_RECEIVED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** The stored per-type preference. Mirrors `notification_preferences`. */
export interface ChannelPreference {
  readonly inApp: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
}

/**
 * Applied when the user has never expressed a preference for a type. Matches
 * the column defaults in STEP 3, so an absent row and a default row behave
 * identically — there is no hidden third state.
 */
export const DEFAULT_CHANNEL_PREFERENCE: ChannelPreference = {
  inApp: true,
  email: true,
  sms: false,
  whatsapp: false,
};

/**
 * Types whose in-app record the user cannot switch off.
 *
 * Money, disputes, and decisions waiting on the recipient. The list is
 * deliberately short: everything on it is something a reasonable person would
 * say they must be told, and something the platform may later have to show it
 * told them.
 */
export const ALWAYS_IN_APP: readonly NotificationType[] = [
  'PAYMENT_SUCCESSFUL',
  'MILESTONE_FUNDED',
  'PAYMENT_RELEASED',
  'PAYOUT_PROCESSED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'VERIFICATION_DECIDED',
  'AI_APPROVAL_REQUIRED',
  'MILESTONE_SUBMITTED',
  'REVISION_REQUESTED',
];

export function isAlwaysInApp(type: NotificationType): boolean {
  return ALWAYS_IN_APP.includes(type);
}

/** Context that can suppress a notification the user would otherwise receive. */
export interface RoutingContext {
  /** The recipient muted the conversation this notification came from. */
  readonly conversationMuted?: boolean | undefined;
  /** The recipient is the person who caused the event. */
  readonly actedThemselves?: boolean | undefined;
}

/**
 * The channels one notification should be delivered on.
 *
 * An empty result is a legitimate outcome — the notification is then not
 * recorded at all, rather than recorded and never sent.
 */
export function channelsFor(
  type: NotificationType,
  preference: ChannelPreference | null | undefined,
  context: RoutingContext = {},
): readonly NotificationChannel[] {
  // Nobody is notified about their own action. This is the single largest
  // source of noise in a marketplace inbox, and it carries no information.
  if (context.actedThemselves === true) return [];

  // Thread muting applies to thread traffic only.
  if (type === 'MESSAGE_RECEIVED' && context.conversationMuted === true) return [];

  const effective = preference ?? DEFAULT_CHANNEL_PREFERENCE;
  const channels: NotificationChannel[] = [];

  if (effective.inApp || isAlwaysInApp(type)) channels.push('IN_APP');
  if (effective.email) channels.push('EMAIL');
  if (effective.sms) channels.push('SMS');
  if (effective.whatsapp) channels.push('WHATSAPP');

  return channels;
}

/**
 * Apply a partial preference update to what is stored.
 *
 * Returned as a whole preference so the caller writes one row rather than
 * merging at the database. Turning off an `ALWAYS_IN_APP` type's in-app channel
 * is accepted and stored — `channelsFor` still delivers it, so the user's
 * stated wish is not silently rewritten, and it takes effect for every type
 * where it is allowed to.
 */
export type ChannelPreferenceUpdate = { readonly [K in keyof ChannelPreference]?: boolean | undefined };

export function mergePreference(
  current: ChannelPreference | null | undefined,
  update: ChannelPreferenceUpdate,
): ChannelPreference {
  const base = current ?? DEFAULT_CHANNEL_PREFERENCE;
  return {
    inApp: update.inApp ?? base.inApp,
    email: update.email ?? base.email,
    sms: update.sms ?? base.sms,
    whatsapp: update.whatsapp ?? base.whatsapp,
  };
}
