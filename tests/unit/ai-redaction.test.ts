import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  REDACTED,
  createRedactionContext,
  redactForStorage,
  redactPii,
  redactString,
  restoreIdentifiers,
} from '../../ai/redaction/redact';

describe('value redaction', () => {
  it('masks email addresses, including inside prose', () => {
    expect(redactString('Contact me at nina.customer@example.com please')).toBe(
      'Contact me at [EMAIL] please',
    );
  });

  it('masks phone numbers in several formats', () => {
    expect(redactString('call +91 98765 43210')).toContain('[PHONE]');
    expect(redactString('ring 020-7946-0958 today')).toContain('[PHONE]');
    expect(redactString('reach me on (415) 555 2671')).toContain('[PHONE]');
  });

  it('masks card-shaped digit runs', () => {
    expect(redactString('card 4111 1111 1111 1111 expires soon')).toContain('[CARD]');
    expect(redactString('4111111111111111')).toBe('[CARD]');
  });

  it('masks provider secrets that should never appear at all', () => {
    expect(redactString('key sk-ant-api03-abcdefgh')).toContain('[KEY]');
    expect(redactString('rzp_live_ABCdef123456')).toContain('[KEY]');
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).toContain('[KEY]');
  });

  it('leaves ordinary project prose untouched', () => {
    const text = 'Rebuild the customer account portal with a 6 week timeline.';
    expect(redactString(text)).toBe(text);
  });
});

describe('key redaction', () => {
  it('masks sensitive keys regardless of their value', () => {
    const result = redactPii({
      password: 'correct horse battery staple',
      mfaSecret: 'JBSWY3DPEHPK3PXP',
      apiKey: 'anything at all',
      sessionToken: 'abc',
      cvv: '123',
      title: 'Keep me',
    }) as Record<string, unknown>;

    expect(result.password).toBe(REDACTED);
    expect(result.mfaSecret).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.sessionToken).toBe(REDACTED);
    expect(result.cvv).toBe(REDACTED);
    expect(result.title).toBe('Keep me');
  });

  it('matches key names irrespective of case and separators', () => {
    const result = redactPii({
      PASSWORD_HASH: 'x',
      'card-number': '1',
      Account_Number: '2',
    }) as Record<string, unknown>;

    expect(Object.values(result).every((value) => value === REDACTED)).toBe(true);
  });
});

describe('structure handling', () => {
  it('preserves shape while masking values', () => {
    const result = redactPii({
      project: { title: 'Portal', contact: 'a@b.com' },
      tags: ['one', 'two@three.com'],
    }) as { project: Record<string, unknown>; tags: string[] };

    expect(result.project.title).toBe('Portal');
    expect(result.project.contact).toBe('[EMAIL]');
    expect(result.tags[0]).toBe('one');
    expect(result.tags[1]).toBe('[EMAIL]');
  });

  it('passes non-string primitives through unchanged', () => {
    const result = redactPii({ count: 42, ok: true, missing: null }) as Record<string, unknown>;
    expect(result).toEqual({ count: 42, ok: true, missing: null });
  });

  it('serialises dates rather than mangling them', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    expect(redactPii({ when })).toEqual({ when: '2026-01-01T00:00:00.000Z' });
  });

  it('survives a circular structure', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(() => redactPii(node)).not.toThrow();
    expect((redactPii(node) as Record<string, unknown>).self).toBe('[CIRCULAR]');
  });

  it('stops at the depth limit instead of exhausting the stack', () => {
    let deep: Record<string, unknown> = { value: 'end' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => redactPii(deep)).not.toThrow();
  });
});

describe('redactForStorage', () => {
  it('returns a JSON-safe object with undefined stripped', () => {
    const stored = redactForStorage({ a: 1, b: undefined, c: 'x@y.com' }) as Record<string, unknown>;
    expect(stored).toEqual({ a: 1, c: '[EMAIL]' });
    expect('b' in stored).toBe(false);
  });

  it('wraps a non-object so the column always receives an object', () => {
    expect(redactForStorage('plain string')).toEqual({ value: 'plain string' });
    expect(redactForStorage(null)).toEqual({ value: null });
  });

  it('redacts before anything is persisted', () => {
    const stored = JSON.stringify(
      redactForStorage({ description: 'email me at leak@example.com or call 9876543210' }),
    );
    expect(stored).not.toContain('leak@example.com');
    expect(stored).not.toContain('9876543210');
  });
});

/**
 * Identifier handling.
 *
 * The regression this suite exists for: the phone rule used to run as its own
 * whole-string pass and ate the digit-and-dash tail of a UUID, so roughly a
 * quarter of real primary keys reached the AI layer as
 * `550e8400-e29b-41d4-a716-[PHONE]`. A tool call built from one of those could
 * only fail, and the failure looked like a flaky provider.
 */
describe('identifiers', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** A UUIDv7 exactly as Prisma mints one. */
  function uuidV7(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  it('leaves a UUID intact when there is no context to map it into', () => {
    // The exact id the old phone rule corrupted.
    expect(redactString('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('never corrupts a UUID, across a large random sample', () => {
    const context = createRedactionContext();
    for (let i = 0; i < 5_000; i += 1) {
      const id = uuidV7();

      const kept = redactString(id);
      expect(kept, `pass-through of ${id}`).toBe(id);

      const surrogate = redactString(id, context);
      expect(surrogate, `surrogate for ${id}`).toMatch(UUID);
      expect(context.realFor(surrogate)).toBe(id);
    }
  });

  it('replaces a UUID with a structurally valid surrogate that is not the original', () => {
    const context = createRedactionContext();
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    const surrogate = redactString(id, context);

    expect(surrogate).toMatch(UUID);
    expect(surrogate).not.toBe(id);
    // Version 8: reserved for custom use, so it can never shadow a v7 key.
    expect(surrogate[14]).toBe('8');
    expect('89ab').toContain(surrogate[19]);
  });

  it('maps the same identifier to the same surrogate within one context', () => {
    const context = createRedactionContext();
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    const first = redactString(`project ${id}`, context);
    const second = redactString(`again ${id}`, context);

    expect(first.slice('project '.length)).toBe(second.slice('again '.length));
    expect(context.size).toBe(1);
  });

  it('maps repeated identifiers consistently inside one payload', () => {
    const context = createRedactionContext();
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    const result = redactPii(
      { projectId: id, note: `see ${id}`, related: [{ projectId: id }] },
      context,
    ) as { projectId: string; note: string; related: { projectId: string }[] };

    expect(result.projectId).toMatch(UUID);
    expect(result.note).toBe(`see ${result.projectId}`);
    expect(result.related[0]!.projectId).toBe(result.projectId);
    expect(context.size).toBe(1);
  });

  it('gives different identifiers different surrogates', () => {
    const context = createRedactionContext();
    const a = redactString('018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f', context);
    const b = redactString('018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e70', context);
    expect(a).not.toBe(b);
    expect(context.size).toBe(2);
  });

  it('gives different contexts different surrogates for the same identifier', () => {
    // A keyed hash would be stable forever and hand a vendor a durable handle.
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    expect(redactString(id, createRedactionContext())).not.toBe(
      redactString(id, createRedactionContext()),
    );
  });

  it('is idempotent: redacting an already-redacted value changes nothing', () => {
    const context = createRedactionContext();
    const once = redactPii(
      { projectId: '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f', email: 'a@b.com', phone: '+91 98765 43210' },
      context,
    );
    const twice = redactPii(once, context);

    expect(twice).toEqual(once);
    expect(context.size).toBe(1);
  });

  it('leaves a placeholder from an earlier pass alone', () => {
    for (const token of ['[EMAIL]', '[PHONE]', '[CARD]', '[KEY]', '[NATIONAL_ID]', REDACTED]) {
      expect(redactString(token)).toBe(token);
    }
  });

  it('turns surrogates back into the rows they stand for', () => {
    const context = createRedactionContext();
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    const sent = redactPii({ projectId: id, steps: [{ projectId: id }] }, context);

    expect(restoreIdentifiers(sent, context)).toEqual({
      projectId: id,
      steps: [{ projectId: id }],
    });
  });

  it('leaves a UUID it never issued alone when restoring', () => {
    const context = createRedactionContext();
    const invented = '018f3c2a-7b1e-7c4d-9e2f-999999999999';
    expect(restoreIdentifiers({ projectId: invented }, context)).toEqual({ projectId: invented });
  });

  it('keeps real identifiers in what we store, so a held approval can still run', () => {
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    expect(redactForStorage({ projectId: id, contact: 'a@b.com' })).toEqual({
      projectId: id,
      contact: '[EMAIL]',
    });
  });

  it('redacts PII sitting next to an identifier without touching the identifier', () => {
    const context = createRedactionContext();
    const id = '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f';
    const result = redactString(`project ${id} — call +91 98765 43210 or mail nina@example.com`, context);

    expect(result).toContain('[PHONE]');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain(id);
    expect(result.match(UUID_IN_PROSE)?.[0]).toBe(context.surrogateFor(id));
  });

  const UUID_IN_PROSE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it('does not mistake a project number for a phone number', () => {
    expect(redactString('P-20260926-AB12CD')).toBe('P-20260926-AB12CD');
  });
});

describe('redaction policy is not weakened by the identifier rule', () => {
  const context = createRedactionContext();

  it('still masks every category when a context is in play', () => {
    const result = redactPii(
      {
        projectId: '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f',
        email: 'nina.customer@example.com',
        phone: '+91 98765 43210',
        card: '4111 1111 1111 1111',
        aadhaar12: '1234 5678 9012',
        anthropic: 'sk-ant-api03-abcdefgh',
        razorpay: 'rzp_live_ABCdef123456',
        aws: 'AKIAIOSFODNN7EXAMPLE',
        password: 'hunter2',
        mfaSecret: 'JBSWY3DPEHPK3PXP',
      },
      context,
    ) as Record<string, string>;

    expect(result.email).toBe('[EMAIL]');
    expect(result.phone).toBe('[PHONE]');
    expect(result.card).toBe('[CARD]');
    expect(result.aadhaar12).toBe('[NATIONAL_ID]');
    expect(result.anthropic).toBe('[KEY]');
    expect(result.razorpay).toBe('[KEY]');
    expect(result.aws).toBe('[KEY]');
    expect(result.password).toBe(REDACTED);
    expect(result.mfaSecret).toBe(REDACTED);
  });

  it('handles null, undefined and empty values without throwing', () => {
    const context2 = createRedactionContext();
    expect(redactPii(null, context2)).toBeNull();
    expect(redactPii(undefined, context2)).toBeUndefined();
    expect(redactPii('', context2)).toBe('');
    expect(redactPii({ a: null, b: undefined, c: [] }, context2)).toEqual({
      a: null,
      b: undefined,
      c: [],
    });
    expect(restoreIdentifiers(null, context2)).toBeNull();
    expect(restoreIdentifiers(undefined, context2)).toBeUndefined();
  });

  it('masks several distinct identifiers in one payload, each only once', () => {
    const context3 = createRedactionContext();
    const result = JSON.stringify(
      redactPii(
        {
          a: '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f',
          b: '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e70',
          contacts: ['one@example.com', 'two@example.com'],
          phones: ['+91 98765 43210', '020-7946-0958'],
        },
        context3,
      ),
    );

    expect(result).not.toContain('1a2b3c4d5e6f');
    expect(result).not.toContain('1a2b3c4d5e70');
    expect(result).not.toContain('@example.com');
    expect(result).not.toContain('98765');
    expect(context3.size).toBe(2);
  });
});
