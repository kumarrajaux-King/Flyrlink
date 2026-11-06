/**
 * The same-origin check that backs up the `SameSite=Lax` cookie.
 *
 * The two cases worth pinning are the ones that could silently break things:
 * a safe method is never blocked, and a request with no `Origin` header is
 * never blocked — otherwise every non-browser caller, including the test suite
 * and the walkthrough, would start failing for no security gain.
 */

import { describe, expect, it } from 'vitest';

import { checkOrigin, isMutating } from '../../lib/http/origin';

function request(method: string, origin: string | null, url = 'http://localhost:3000/api/auth/login') {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  return { method, headers, url };
}

describe('same-origin check', () => {
  it('knows which methods can change something', () => {
    for (const method of ['POST', 'put', 'PATCH', 'delete']) expect(isMutating(method), method).toBe(true);
    for (const method of ['GET', 'head', 'OPTIONS']) expect(isMutating(method), method).toBe(false);
  });

  it('never blocks a safe method, whatever origin it claims', () => {
    expect(checkOrigin(request('GET', 'https://evil.example'))).toBe('ALLOWED');
    expect(checkOrigin(request('HEAD', 'https://evil.example'))).toBe('ALLOWED');
  });

  it('allows a mutating request from the same origin', () => {
    expect(checkOrigin(request('POST', 'http://localhost:3000'))).toBe('ALLOWED');
  });

  it('blocks a mutating request from another origin', () => {
    expect(checkOrigin(request('POST', 'https://evil.example'))).toBe('CROSS_ORIGIN');
  });

  it('treats a different port as a different origin', () => {
    expect(checkOrigin(request('POST', 'http://localhost:3001'))).toBe('CROSS_ORIGIN');
  });

  it('allows a request with no Origin header', () => {
    // curl, a server-to-server call and the test suite all send none; a browser
    // sets it itself on cross-origin and on POST, so a forgery cannot omit it.
    expect(checkOrigin(request('POST', null))).toBe('ALLOWED');
  });

  it('blocks an unparseable Origin rather than guessing', () => {
    expect(checkOrigin(request('POST', 'not-a-url'))).toBe('CROSS_ORIGIN');
  });

  it('compares against the request URL, so it works on any host', () => {
    expect(checkOrigin(request('POST', 'https://app.flyrlink.test', 'https://app.flyrlink.test/api/x'))).toBe('ALLOWED');
    expect(checkOrigin(request('POST', 'https://app.flyrlink.test', 'https://other.test/api/x'))).toBe('CROSS_ORIGIN');
  });
});
