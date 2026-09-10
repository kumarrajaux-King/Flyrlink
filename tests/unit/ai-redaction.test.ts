import { describe, expect, it } from 'vitest';

import { REDACTED, redactForStorage, redactPii, redactString } from '../../ai/redaction/redact';

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
