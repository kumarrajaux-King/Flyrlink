/**
 * Notifications: recording them, listing them, and getting them out.
 *
 * THE SHAPE OF THE THING
 *   One notification produces one row *per channel*. That is deliberate. A
 *   single row with a channel column and a "sent" flag cannot answer "was the
 *   email delivered but the SMS refused?", which is exactly the question an
 *   operator asks when a customer says they were never told. Per-channel rows
 *   make delivery state per-channel truth.
 *
 *   The rows are written inside the caller's transaction, so a notification and
 *   the state change it describes commit together or not at all. External
 *   delivery is NOT attempted there: a provider call inside a lifecycle
 *   transaction would hold a row lock across a network round-trip, and a
 *   provider timeout would roll back a milestone approval that had already
 *   happened. So the write records the intent, and `dispatchPending` sends,
 *   after commit and out of band. `AiRun.status = QUEUED` already established
 *   this pattern (T-05: a database-backed queue before Redis).
 *
 * WHAT A USER MAY SEE
 *   Their own notifications, and nothing else. There is no `notification:read:any`
 *   permission and no admin route into this service: a platform administrator
 *   investigating a case reads the audit log and the underlying records, not the
 *   recipient's personal inbox.
 */

import {
  type ChannelPreference,
  type ChannelPreferenceUpdate,
  DEFAULT_CHANNEL_PREFERENCE,
  type NotificationChannel,
  NOTIFICATION_TYPES,
  type NotificationType,
  type RoutingContext,
  channelsFor,
  mergePreference,
} from '../../domain/notification/routing';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { type Page, type PageRequest, iso, newestFirst, pageSize, toPage } from '../../lib/pagination';
import { channelAdapter, isImmediateChannel } from './channels';

/** One thing to tell one person. */
export interface NotificationIntent {
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly entityType?: string | null | undefined;
  readonly entityId?: string | null | undefined;
  readonly actionUrl?: string | null | undefined;
  /** Suppression inputs — muted thread, or the recipient acted themselves. */
  readonly routing?: RoutingContext | undefined;
}

export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly actionUrl: string | null;
  readonly readAt: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

function view(row: {
  id: string;
  type: string;
  channel: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  readAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: row.id,
    type: row.type,
    channel: row.channel,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    actionUrl: row.actionUrl,
    readAt: iso(row.readAt),
    sentAt: iso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The recipient's stored preference for one type, or null when unset. */
async function preferenceFor(
  db: Db,
  userId: string,
  type: NotificationType,
): Promise<ChannelPreference | null> {
  const row = await db.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
    select: { inApp: true, email: true, sms: true, whatsapp: true },
  });
  return row ?? null;
}

/**
 * Record one notification on every channel it should go out on.
 *
 * Returns the ids created — empty when routing suppressed it entirely, which is
 * a normal outcome and not an error. A recipient who does not exist, or whose
 * account is deleted, is skipped for the same reason.
 */
export async function notify(db: Db, intent: NotificationIntent): Promise<readonly string[]> {
  const recipient = await db.user.findFirst({
    where: { id: intent.userId, deletedAt: null },
    select: { id: true },
  });
  if (!recipient) return [];

  const preference = await preferenceFor(db, intent.userId, intent.type);
  const channels = channelsFor(intent.type, preference, intent.routing ?? {});
  if (channels.length === 0) return [];

  const now = new Date();
  const created: string[] = [];

  for (const channel of channels) {
    const row = await db.notification.create({
      data: {
        userId: intent.userId,
        type: intent.type,
        channel,
        title: intent.title,
        body: intent.body,
        entityType: intent.entityType ?? null,
        entityId: intent.entityId ?? null,
        actionUrl: intent.actionUrl ?? null,
        // In-app delivery is the row itself, so it is complete on write.
        // Everything else waits for `dispatchPending`.
        sentAt: isImmediateChannel(channel) ? now : null,
      },
      select: { id: true },
    });
    created.push(row.id);
  }

  return created;
}

/** Record several notifications. Used where one event tells both parties. */
export async function notifyMany(
  db: Db,
  intents: readonly NotificationIntent[],
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (const intent of intents) {
    ids.push(...(await notify(db, intent)));
  }
  return ids;
}

export interface DispatchSummary {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
}

/**
 * Send the queued external-channel notifications.
 *
 * Runs outside any lifecycle transaction. A provider failure is recorded on the
 * row — `failedAt` plus a reason — and never retried blindly here: a retry
 * policy belongs with the real providers in Phase 12, and silently re-sending a
 * message whose failure mode is unknown is how a recipient gets the same SMS
 * eleven times.
 */
export async function dispatchPending(db: Db = prisma, limit = 50): Promise<DispatchSummary> {
  const pending = await db.notification.findMany({
    where: { sentAt: null, failedAt: null, channel: { not: 'IN_APP' } },
    orderBy: { id: 'asc' },
    take: Math.min(Math.max(Math.trunc(limit), 1), 500),
    select: {
      id: true,
      userId: true,
      type: true,
      channel: true,
      title: true,
      body: true,
      actionUrl: true,
      user: { select: { email: true, phone: true } },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    const channel = row.channel as NotificationChannel;
    const destination = channel === 'EMAIL' ? row.user.email : row.user.phone;

    try {
      await channelAdapter(channel).send({
        userId: row.userId,
        type: row.type,
        title: row.title,
        body: row.body,
        actionUrl: row.actionUrl,
        destination,
      });
      await db.notification.update({ where: { id: row.id }, data: { sentAt: new Date() } });
      sent += 1;
    } catch (error) {
      await db.notification.update({
        where: { id: row.id },
        data: {
          failedAt: new Date(),
          // The message, never the stack: this is read by operators and kept.
          failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery failure.',
        },
      });
      failed += 1;
    }
  }

  return { attempted: pending.length, sent, failed };
}

export interface NotificationQuery extends PageRequest {
  readonly unreadOnly?: boolean | undefined;
}

/**
 * The caller's own in-app notifications, newest first.
 *
 * In-app only: the email and SMS rows exist for delivery accounting, and
 * showing them in the bell menu would display the same event three times.
 */
export async function listNotifications(
  db: Db,
  actor: Actor,
  query: NotificationQuery = {},
): Promise<Page<NotificationView>> {
  const size = pageSize(query.limit);
  const rows = await db.notification.findMany({
    where: {
      userId: actor.userId,
      channel: 'IN_APP',
      ...(query.unreadOnly === true ? { readAt: null } : {}),
      ...newestFirst(query.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      type: true,
      channel: true,
      title: true,
      body: true,
      entityType: true,
      entityId: true,
      actionUrl: true,
      readAt: true,
      sentAt: true,
      createdAt: true,
    },
  });
  return toPage(rows, size, view);
}

export async function unreadNotificationCount(db: Db, actor: Actor): Promise<number> {
  return db.notification.count({
    where: { userId: actor.userId, channel: 'IN_APP', readAt: null },
  });
}

/**
 * Mark one notification read.
 *
 * Scoped by `userId` in the same statement as the id, so a guessed id belonging
 * to someone else updates nothing rather than reaching a row it should not.
 * Returns false when nothing matched — the caller cannot tell "not yours" from
 * "not there", which is the intended answer to both.
 */
export async function markNotificationRead(db: Db, actor: Actor, notificationId: string): Promise<boolean> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

/** Mark every unread in-app notification read. Returns how many changed. */
export async function markAllNotificationsRead(db: Db, actor: Actor): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId: actor.userId, channel: 'IN_APP', readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export interface PreferenceView extends ChannelPreference {
  readonly type: string;
  /** True when this is the default rather than something the user chose. */
  readonly isDefault: boolean;
}

/** Every type, with the user's choice where they made one and the default elsewhere. */
export async function listPreferences(db: Db, actor: Actor): Promise<readonly PreferenceView[]> {
  const stored = await db.notificationPreference.findMany({
    where: { userId: actor.userId },
    select: { type: true, inApp: true, email: true, sms: true, whatsapp: true },
  });
  const byType = new Map(stored.map((row) => [row.type, row]));

  return NOTIFICATION_TYPES.map((type) => {
    const row = byType.get(type);
    return {
      type,
      inApp: row?.inApp ?? DEFAULT_CHANNEL_PREFERENCE.inApp,
      email: row?.email ?? DEFAULT_CHANNEL_PREFERENCE.email,
      sms: row?.sms ?? DEFAULT_CHANNEL_PREFERENCE.sms,
      whatsapp: row?.whatsapp ?? DEFAULT_CHANNEL_PREFERENCE.whatsapp,
      isDefault: row === undefined,
    };
  });
}

/** Set the caller's preference for one type. Absent fields keep their value. */
export async function updatePreference(
  db: Db,
  actor: Actor,
  type: NotificationType,
  update: ChannelPreferenceUpdate,
): Promise<PreferenceView> {
  const current = await preferenceFor(db, actor.userId, type);
  const merged = mergePreference(current, update);

  await db.notificationPreference.upsert({
    where: { userId_type: { userId: actor.userId, type } },
    create: { userId: actor.userId, type, ...merged },
    update: merged,
  });

  return { type, ...merged, isDefault: false };
}
