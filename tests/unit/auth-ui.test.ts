/**
 * The two pure rules behind the authentication screens.
 *
 * `safeNext` is a security rule wearing a convenience's clothes: it decides
 * which URL the browser is sent to after signing in, so getting it wrong is an
 * open redirect — a phishing primitive, handed out by the real login page.
 *
 * `cleanOtp` is what makes paste work. A code copied out of an authenticator
 * arrives with whatever was around it, and silently refusing such a paste is
 * the kind of bug people blame on themselves.
 */

import { describe, expect, it } from 'vitest';

import { cleanOtp } from '../../components/ui/otp-input';
import { MFA_CHALLENGE_PATH, MFA_ENROLLMENT_PATH, safeNext } from '../../lib/ui/auth-routes';

describe('safeNext', () => {
  it('follows an ordinary same-origin path', () => {
    for (const path of ['/admin', '/admin/finance', '/projects/018f3c2a', '/expert?tab=open']) {
      expect(safeNext(path)).toBe(path);
    }
  });

  it('refuses anything that could leave this origin', () => {
    for (const hostile of [
      'https://evil.test',
      'http://evil.test',
      '//evil.test',
      '//evil.test/admin',
      // Some browsers normalise a backslash to a slash, making this a host.
      '/\\evil.test',
      'javascript:alert(1)',
      'evil.test',
      '',
    ]) {
      expect(safeNext(hostile), hostile).toBe('/dashboard');
    }
  });

  it('refuses a missing value', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext(undefined)).toBe('/dashboard');
  });

  it('refuses to send anyone back into the authentication flow', () => {
    // `/login?next=/login` is how a redirect loop gets built by accident.
    for (const circular of [MFA_CHALLENGE_PATH, `${MFA_CHALLENGE_PATH}?next=%2Fadmin`, '/login', '/login?next=%2F']) {
      expect(safeNext(circular), circular).toBe('/dashboard');
    }
  });

  it('still allows the enrollment screen, which is a real destination', () => {
    expect(safeNext(MFA_ENROLLMENT_PATH)).toBe(MFA_ENROLLMENT_PATH);
  });
});

describe('cleanOtp', () => {
  it('pulls six digits out of whatever was pasted', () => {
    for (const pasted of ['123456', '123 456', '123-456', 'code: 123456', '  123456\n']) {
      expect(cleanOtp(pasted, 'numeric'), pasted).toBe('123456');
    }
  });

  it('stops at six, so a longer paste does not silently send the wrong code', () => {
    expect(cleanOtp('1234567890', 'numeric')).toBe('123456');
  });

  it('keeps a backup code whole, upper-cased, dashes intact', () => {
    expect(cleanOtp('abcd-efgh', 'backup')).toBe('ABCD-EFGH');
    expect(cleanOtp('  abcd efgh  ', 'backup')).toBe('ABCDEFGH');
  });

  it('gives back an empty string rather than throwing on junk', () => {
    expect(cleanOtp('', 'numeric')).toBe('');
    expect(cleanOtp('no digits here', 'numeric')).toBe('');
  });
});

/**
 * The attribute a unit test cannot see.
 *
 * `cleanOtp` was always correct; the field around it was not. `maxLength={6}`
 * truncated the raw text before the cleaner ran, so a pasted "98 76 54" became
 * "98 76 " and cleaned to a four-digit "9876" — accepted by the form, rejected
 * by the server, with nothing on screen explaining why.
 *
 * A browser test caught it. This pins the rule the markup has to keep: the
 * bound on what may be typed is the *cleaned* length, never the raw one.
 */
describe('a pasted code is longer than the code', () => {
  it('cleans separators out of pastes that exceed six raw characters', () => {
    for (const [pasted, expected] of [
      ['98 76 54', '987654'],
      ['123-456', '123456'],
      ['1 2 3 4 5 6', '123456'],
      ['(123) 456', '123456'],
    ] as [string, string][]) {
      expect(cleanOtp(pasted, 'numeric'), pasted).toBe(expected);
      // The raw string is longer than the code — which is the whole trap.
      expect(pasted.length).toBeGreaterThan(6);
    }
  });
});
