/**
 * The bridge from a lifecycle transition to the people it concerns.
 *
 * The engine calls `emitLifecycleNotifications` once, inside the transition's
 * own transaction, after the status write has succeeded. Which events notify
 * whom is the pure table in `domain/notification/lifecycle-map.ts`; this module
 * only resolves the audience to real users and records the notification.
 *
 * INSIDE THE TRANSACTION, ON PURPOSE
 *   A milestone that moved to SUBMITTED and a customer who was never told are
 *   an inconsistent pair. Recording the notification alongside the status write
 *   removes that possibility. It is only the *record* that is written here —
 *   external delivery happens after commit (see the notification service), so
 *   no provider call is made while a row lock is held.
 *
 * WHY THE LINK IS THE PROJECT ROUTE
 *   A notification stores one `actionUrl`, but a customer and an expert reach
 *   the same contract by different paths (STEP 01 §6.2 and §6.3). The canonical
 *   project-scoped route is stored and the frontend sends each role to its own
 *   surface — rather than guessing the recipient's role here and baking it into
 *   a stored string. (Assumption A-15.)
 */

import {
  type LifecycleEntity,
  notificationFor,
  recipientsFor,
} from '../../domain/notification/lifecycle-map';
import type { PrismaTransaction } from '../../lib/db/client';
import { notifyMany } from '../notification/notification-service';
import type { Participants } from './authorization';

/** The project a lifecycle record belongs to, for building its link. */
async function projectIdFor(
  tx: PrismaTransaction,
  entityType: LifecycleEntity,
  entityId: string,
): Promise<string | null> {
  switch (entityType) {
    case 'Project':
      return entityId;
    case 'Contract': {
      const contract = await tx.contract.findUnique({ where: { id: entityId }, select: { projectId: true } });
      return contract?.projectId ?? null;
    }
    case 'Milestone': {
      const milestone = await tx.milestone.findUnique({ where: { id: entityId }, select: { projectId: true } });
      return milestone?.projectId ?? null;
    }
    case 'Payment': {
      const payment = await tx.payment.findUnique({
        where: { id: entityId },
        select: { order: { select: { projectId: true } } },
      });
      return payment?.order.projectId ?? null;
    }
  }
}

const SUFFIX: Record<LifecycleEntity, string> = {
  Project: '',
  Contract: '/contract',
  Milestone: '/milestones',
  Payment: '/payments',
};

async function actionUrlFor(
  tx: PrismaTransaction,
  entityType: LifecycleEntity,
  entityId: string,
): Promise<string | null> {
  const projectId = await projectIdFor(tx, entityType, entityId);
  return projectId ? `/projects/${projectId}${SUFFIX[entityType]}` : null;
}

export interface LifecycleNotificationInput {
  readonly entityType: LifecycleEntity;
  readonly entityId: string;
  readonly event: string;
  readonly participants: Participants;
  /** The human accountable for the transition, if there is one. */
  readonly actorUserId: string | null;
}

/**
 * Record the notifications a transition produces.
 *
 * Returns how many rows were written — zero is the common case, because most
 * events are not worth telling anyone about, and the person who caused an event
 * is never told about their own action.
 */
export async function emitLifecycleNotifications(
  tx: PrismaTransaction,
  input: LifecycleNotificationInput,
): Promise<number> {
  const mapping = notificationFor(input.entityType, input.event);
  if (!mapping) return 0;

  const recipients = recipientsFor(mapping.audience, input.participants);
  if (recipients.length === 0) return 0;

  const actionUrl = await actionUrlFor(tx, input.entityType, input.entityId);

  const written = await notifyMany(
    tx,
    recipients.map((userId) => ({
      userId,
      type: mapping.type,
      title: mapping.title,
      body: mapping.body,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl,
      routing: { actedThemselves: userId === input.actorUserId },
    })),
  );

  return written.length;
}
