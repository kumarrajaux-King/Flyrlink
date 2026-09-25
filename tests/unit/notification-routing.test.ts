/**
 * Notification routing and the lifecycle map.
 *
 * The asymmetry stated in `domain/notification/routing.ts` drives what is
 * tested here: a notification sent that someone muted is an annoyance, while one
 * not sent when an approval was waiting can stall an engagement. So the
 * suppression paths are pinned exactly, and the mandatory ones are pinned
 * against a preference that tries to switch them off.
 */

import { describe, expect, it } from 'vitest';

import {
  type LifecycleEntity,
  mappedEvents,
  notificationFor,
  recipientsFor,
} from '../../domain/notification/lifecycle-map';
import {
  ALWAYS_IN_APP,
  type ChannelPreference,
  DEFAULT_CHANNEL_PREFERENCE,
  NOTIFICATION_TYPES,
  channelsFor,
  mergePreference,
} from '../../domain/notification/routing';
import { CONTRACT_EVENTS } from '../../domain/contract/state-machine';
import { MILESTONE_EVENTS } from '../../domain/milestone/state-machine';
import { PAYMENT_EVENTS } from '../../domain/payment/state-machine';
import { PROJECT_EVENTS } from '../../domain/project/state-machine';

const ALL_OFF: ChannelPreference = { inApp: false, email: false, sms: false, whatsapp: false };
const ALL_ON: ChannelPreference = { inApp: true, email: true, sms: true, whatsapp: true };

describe('channel routing', () => {
  it('uses the defaults when the user has expressed no preference', () => {
    expect(channelsFor('PROJECT_CREATED', null)).toEqual(['IN_APP', 'EMAIL']);
    expect(channelsFor('PROJECT_CREATED', DEFAULT_CHANNEL_PREFERENCE)).toEqual(['IN_APP', 'EMAIL']);
  });

  it('treats an absent preference row and an explicit default row identically', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(channelsFor(type, null)).toEqual(channelsFor(type, DEFAULT_CHANNEL_PREFERENCE));
    }
  });

  it('honours every channel a user turns on', () => {
    expect(channelsFor('PROJECT_CREATED', ALL_ON)).toEqual(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP']);
  });

  it('lets a user silence an ordinary type completely', () => {
    expect(channelsFor('PROJECT_CREATED', ALL_OFF)).toEqual([]);
  });

  it('keeps the in-app record for types the user must not be able to lose', () => {
    for (const type of ALWAYS_IN_APP) {
      expect(channelsFor(type, ALL_OFF)).toEqual(['IN_APP']);
    }
  });

  it('never notifies someone about their own action', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(channelsFor(type, ALL_ON, { actedThemselves: true })).toEqual([]);
    }
  });

  it('applies conversation muting to thread traffic only', () => {
    expect(channelsFor('MESSAGE_RECEIVED', ALL_ON, { conversationMuted: true })).toEqual([]);
    // Muting a thread does not silence the money or the disputes on its project.
    expect(channelsFor('PAYMENT_RELEASED', ALL_ON, { conversationMuted: true })).toContain('IN_APP');
    expect(channelsFor('DISPUTE_OPENED', ALL_ON, { conversationMuted: true })).toContain('IN_APP');
  });

  it('always lists IN_APP first when it is included', () => {
    for (const type of NOTIFICATION_TYPES) {
      const channels = channelsFor(type, ALL_ON);
      if (channels.includes('IN_APP')) expect(channels[0]).toBe('IN_APP');
    }
  });
});

describe('preference merging', () => {
  it('changes only the fields supplied', () => {
    expect(mergePreference(ALL_ON, { sms: false })).toEqual({ ...ALL_ON, sms: false });
  });

  it('starts from the defaults when nothing is stored', () => {
    expect(mergePreference(null, { whatsapp: true })).toEqual({ ...DEFAULT_CHANNEL_PREFERENCE, whatsapp: true });
  });

  it('stores an in-app opt-out even for a mandatory type rather than silently refusing it', () => {
    const merged = mergePreference(null, { inApp: false });
    expect(merged.inApp).toBe(false);
    // Stored as asked, and still delivered in-app where the rules require it.
    expect(channelsFor('DISPUTE_OPENED', merged)).toContain('IN_APP');
    expect(channelsFor('PROJECT_CREATED', merged)).not.toContain('IN_APP');
  });
});

describe('lifecycle notification map', () => {
  const MACHINE_EVENTS: Record<LifecycleEntity, readonly string[]> = {
    Project: PROJECT_EVENTS,
    Contract: CONTRACT_EVENTS,
    Milestone: MILESTONE_EVENTS,
    Payment: PAYMENT_EVENTS,
  };

  it('only maps events the state machines actually have', () => {
    // Catches a typo'd or renamed event, which would otherwise notify nobody
    // and fail silently forever.
    for (const [entity, events] of Object.entries(MACHINE_EVENTS) as [LifecycleEntity, readonly string[]][]) {
      for (const mapped of mappedEvents(entity)) {
        expect(events).toContain(mapped);
      }
    }
  });

  it('only produces notification types the schema knows', () => {
    for (const entity of Object.keys(MACHINE_EVENTS) as LifecycleEntity[]) {
      for (const event of mappedEvents(entity)) {
        expect(NOTIFICATION_TYPES).toContain(notificationFor(entity, event)!.type);
      }
    }
  });

  it('returns null for an unmapped event', () => {
    expect(notificationFor('Project', 'START_ANALYSIS')).toBeNull();
    expect(notificationFor('Project', 'NOT_AN_EVENT')).toBeNull();
  });

  it('tells the customer when work is submitted and the expert when it is approved', () => {
    expect(notificationFor('Milestone', 'SUBMIT')).toMatchObject({
      type: 'MILESTONE_SUBMITTED',
      audience: 'CUSTOMER',
    });
    expect(notificationFor('Milestone', 'APPROVE')).toMatchObject({
      type: 'MILESTONE_APPROVED',
      audience: 'EXPERT',
    });
  });

  it('tells both sides about disputes and releases', () => {
    expect(notificationFor('Project', 'RAISE_DISPUTE')!.audience).toBe('BOTH');
    expect(notificationFor('Payment', 'RELEASE')!.audience).toBe('BOTH');
  });

  it('writes copy that promises nothing', () => {
    for (const entity of Object.keys(MACHINE_EVENTS) as LifecycleEntity[]) {
      for (const event of mappedEvents(entity)) {
        const mapping = notificationFor(entity, event)!;
        expect(mapping.title.length).toBeGreaterThan(0);
        expect(mapping.title.length).toBeLessThanOrEqual(160);
        expect(mapping.body.length).toBeLessThanOrEqual(1000);
        expect(mapping.body).not.toMatch(/guarantee|urgent|act now|immediately/i);
      }
    }
  });
});

describe('audience resolution', () => {
  const parties = { customerUserId: 'customer-1', expertUserIds: ['expert-1', 'expert-2'] };

  it('resolves each side', () => {
    expect(recipientsFor('CUSTOMER', parties)).toEqual(['customer-1']);
    expect(recipientsFor('EXPERT', parties)).toEqual(['expert-1', 'expert-2']);
    expect(recipientsFor('BOTH', parties)).toEqual(['customer-1', 'expert-1', 'expert-2']);
  });

  it('copes with a project that has no expert yet', () => {
    expect(recipientsFor('BOTH', { customerUserId: 'customer-1', expertUserIds: [] })).toEqual(['customer-1']);
    expect(recipientsFor('EXPERT', { customerUserId: 'customer-1', expertUserIds: [] })).toEqual([]);
  });

  it('de-duplicates someone who appears on both sides', () => {
    expect(recipientsFor('BOTH', { customerUserId: 'same', expertUserIds: ['same'] })).toEqual(['same']);
  });
});
