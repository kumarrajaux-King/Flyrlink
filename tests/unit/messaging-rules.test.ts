/**
 * The pure messaging rules: who may read, who may post, what may be changed
 * afterwards, and what may be attached.
 *
 * These are the decisions that keep one party out of another's conversation, so
 * they are tested exhaustively rather than representatively — including the
 * cases that only differ in which refusal they produce, because the refusal is
 * what the UI shows and what an operator reads.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  buildFileKey,
  extensionOf,
  sanitizeFileName,
  uploadRefusal,
} from '../../domain/attachment/rules';
import {
  type ConversationSubject,
  canPostToConversation,
  canReadConversation,
} from '../../domain/messaging/conversation-access';
import {
  DELETED_MESSAGE_TOMBSTONE,
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_RATE_LIMIT,
  deleteRefusal,
  editRefusal,
  exceedsRateLimit,
  visibleBody,
} from '../../domain/messaging/message-rules';
import type { Actor } from '../../lib/authz/authorize';
import type { RoleName } from '../../lib/authz/roles';

const MEMBER = 'user-member';
const OTHER_MEMBER = 'user-other-member';
const STRANGER = 'user-stranger';
const FORMER = 'user-former';

function actor(userId: string, roles: RoleName[], overrides: Partial<Actor> = {}): Actor {
  return { userId, roles, mfaSatisfied: true, accountActive: true, ...overrides };
}

function thread(overrides: Partial<ConversationSubject> = {}): ConversationSubject {
  return {
    type: 'PROJECT',
    isArchived: false,
    memberUserIds: [MEMBER, OTHER_MEMBER],
    formerMemberUserIds: [FORMER],
    ...overrides,
  };
}

describe('conversation read access', () => {
  it('lets a member read', () => {
    expect(canReadConversation(actor(MEMBER, ['CUSTOMER']), thread())).toEqual({
      allowed: true,
      basis: 'MEMBER',
    });
  });

  it('lets an oversight role read without membership', () => {
    for (const role of ['ADMIN', 'SUPPORT', 'SUPER_ADMIN'] as const) {
      expect(canReadConversation(actor(STRANGER, [role]), thread())).toEqual({
        allowed: true,
        basis: 'OVERSIGHT',
      });
    }
  });

  it('refuses a stranger with no oversight grant', () => {
    expect(canReadConversation(actor(STRANGER, ['CUSTOMER']), thread())).toEqual({
      allowed: false,
      reason: 'NOT_A_MEMBER',
    });
  });

  it('tells a removed member that their membership ended, not that they were never in it', () => {
    expect(canReadConversation(actor(FORMER, ['EXPERT']), thread())).toEqual({
      allowed: false,
      reason: 'MEMBERSHIP_ENDED',
    });
  });

  it('still lets members read an archived thread', () => {
    expect(canReadConversation(actor(MEMBER, ['CUSTOMER']), thread({ isArchived: true })).allowed).toBe(true);
  });

  it('refuses an unauthenticated caller', () => {
    expect(canReadConversation(null, thread())).toEqual({ allowed: false, reason: 'NOT_AUTHENTICATED' });
  });

  it('refuses a suspended account even when it is a member', () => {
    const suspended = actor(MEMBER, ['CUSTOMER'], { accountActive: false });
    expect(canReadConversation(suspended, thread())).toEqual({ allowed: false, reason: 'ACCOUNT_INACTIVE' });
  });

  it('refuses an admin session that has not cleared MFA', () => {
    const unverified = actor(STRANGER, ['ADMIN'], { mfaSatisfied: false });
    expect(canReadConversation(unverified, thread())).toEqual({ allowed: false, reason: 'MFA_REQUIRED' });
  });
});

describe('conversation post access', () => {
  it('lets a member post', () => {
    expect(canPostToConversation(actor(MEMBER, ['EXPERT']), thread())).toEqual({
      allowed: true,
      basis: 'MEMBER',
    });
  });

  it('does NOT let oversight post into a project thread', () => {
    // The whole point of separating read from write: ADMIN and SUPPORT can
    // investigate a thread without being able to speak in it as a party.
    for (const role of ['ADMIN', 'SUPPORT'] as const) {
      const decision = canPostToConversation(actor(STRANGER, [role]), thread());
      expect(decision.allowed).toBe(false);
    }
  });

  it('lets support respond in a SUPPORT thread', () => {
    expect(canPostToConversation(actor(STRANGER, ['SUPPORT']), thread({ type: 'SUPPORT' }))).toEqual({
      allowed: true,
      basis: 'SUPPORT_RESPONDER',
    });
  });

  it('does not let a customer post into a SUPPORT thread they are not in', () => {
    expect(canPostToConversation(actor(STRANGER, ['CUSTOMER']), thread({ type: 'SUPPORT' })).allowed).toBe(false);
  });

  it('refuses everyone once the thread is archived', () => {
    expect(canPostToConversation(actor(MEMBER, ['CUSTOMER']), thread({ isArchived: true }))).toEqual({
      allowed: false,
      reason: 'CONVERSATION_ARCHIVED',
    });
    expect(canPostToConversation(actor(STRANGER, ['SUPPORT']), thread({ type: 'SUPPORT', isArchived: true }))).toEqual(
      { allowed: false, reason: 'CONVERSATION_ARCHIVED' },
    );
  });

  it('decides authorization before state, so a stranger never learns the thread is archived', () => {
    const decision = canPostToConversation(actor(STRANGER, ['CUSTOMER']), thread({ isArchived: true }));
    expect(decision).toEqual({ allowed: false, reason: 'NOT_A_MEMBER' });
  });
});

describe('message mutation rules', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  const fresh = { senderUserId: MEMBER, type: 'USER' as const, createdAt: now, deletedAt: null };

  it('lets the author edit inside the window', () => {
    expect(editRefusal(MEMBER, fresh, new Date(now.getTime() + MESSAGE_EDIT_WINDOW_MS - 1))).toBeNull();
  });

  it('refuses an edit once the window has passed', () => {
    expect(editRefusal(MEMBER, fresh, new Date(now.getTime() + MESSAGE_EDIT_WINDOW_MS + 1))).toBe(
      'EDIT_WINDOW_EXPIRED',
    );
  });

  it('refuses anyone who is not the author, before considering the window', () => {
    expect(editRefusal(OTHER_MEMBER, fresh, new Date(now.getTime() + MESSAGE_EDIT_WINDOW_MS + 1))).toBe(
      'NOT_THE_AUTHOR',
    );
  });

  it('refuses editing SYSTEM and AI_AGENT messages', () => {
    for (const type of ['SYSTEM', 'AI_AGENT'] as const) {
      expect(editRefusal(MEMBER, { ...fresh, type }, now)).toBe('NOT_A_USER_MESSAGE');
    }
  });

  it('refuses a message whose sender account is gone', () => {
    expect(editRefusal(MEMBER, { ...fresh, senderUserId: null }, now)).toBe('NOT_THE_AUTHOR');
  });

  it('allows deletion with no time limit, but only once', () => {
    const old = { ...fresh, createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    expect(deleteRefusal(MEMBER, old)).toBeNull();
    expect(deleteRefusal(MEMBER, { ...old, deletedAt: now })).toBe('ALREADY_DELETED');
  });

  it('never lets one member delete another member’s message', () => {
    expect(deleteRefusal(OTHER_MEMBER, fresh)).toBe('NOT_THE_AUTHOR');
  });

  it('replaces a deleted body with a tombstone and keeps a live one intact', () => {
    expect(visibleBody({ body: 'hello', deletedAt: null })).toBe('hello');
    expect(visibleBody({ body: 'hello', deletedAt: new Date() })).toBe(DELETED_MESSAGE_TOMBSTONE);
  });

  it('rate limits at the configured count, not before', () => {
    expect(exceedsRateLimit(MESSAGE_RATE_LIMIT.maxMessages - 1)).toBe(false);
    expect(exceedsRateLimit(MESSAGE_RATE_LIMIT.maxMessages)).toBe(true);
  });
});

describe('attachment rules', () => {
  const good = { fileName: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 1024 };

  it('accepts a well-formed upload', () => {
    expect(uploadRefusal(good)).toBeNull();
  });

  it('accepts every extension listed for every allowed type', () => {
    for (const [mimeType, extensions] of Object.entries(ALLOWED_MIME_TYPES)) {
      for (const extension of extensions) {
        expect(uploadRefusal({ fileName: `file.${extension}`, mimeType, sizeBytes: 10 })).toBeNull();
      }
    }
  });

  it('refuses a type that is not on the list', () => {
    expect(uploadRefusal({ ...good, fileName: 'run.exe', mimeType: 'application/x-msdownload' })).toBe(
      'UNSUPPORTED_TYPE',
    );
  });

  it('refuses an extension that contradicts the declared type', () => {
    expect(uploadRefusal({ ...good, fileName: 'invoice.pdf', mimeType: 'image/png' })).toBe('EXTENSION_MISMATCH');
  });

  it('ignores media-type parameters when matching', () => {
    expect(uploadRefusal({ fileName: 'notes.txt', mimeType: 'text/plain; charset=utf-8', sizeBytes: 5 })).toBeNull();
  });

  it('refuses empty and oversized files', () => {
    expect(uploadRefusal({ ...good, sizeBytes: 0 })).toBe('EMPTY_FILE');
    expect(uploadRefusal({ ...good, sizeBytes: -1 })).toBe('EMPTY_FILE');
    expect(uploadRefusal({ ...good, sizeBytes: MAX_ATTACHMENT_BYTES })).toBeNull();
    expect(uploadRefusal({ ...good, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })).toBe('FILE_TOO_LARGE');
  });

  it('refuses a name that sanitises away to nothing', () => {
    expect(uploadRefusal({ ...good, fileName: '../../' })).toBe('INVALID_FILE_NAME');
  });

  it('strips directories, leading dots and control characters from the display name', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('.hidden.txt')).toBe('hidden.txt');
    expect(sanitizeFileName('bad\u0000name.txt')).toBe('badname.txt');
  });

  it('reads the extension only from a real trailing suffix', () => {
    expect(extensionOf('a.tar.gz')).toBe('gz');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('builds a key from server-controlled values only', () => {
    const key = buildFileKey({
      scope: 'messages',
      scopeId: 'conv-1',
      uploaderUserId: 'user-1',
      uniqueId: 'obj-1',
      fileName: '../../etc/passwd.pdf',
    });
    expect(key).toBe('messages/conv-1/user-1/obj-1.pdf');
    // Nothing the client sent survives into the path.
    expect(key).not.toContain('..');
    expect(key).not.toContain('passwd');
  });
});
