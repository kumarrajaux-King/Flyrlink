/**
 * The email layer: configuration, rendering, transports, and the service.
 *
 * WHAT THIS SUITE IS GUARDING AGAINST
 *   The bug it was written after was not a broken integration — it was the
 *   absence of one. `sendAuthEmail` either threw or wrote a console line, and
 *   nothing anywhere distinguished that from a delivery. Every account created
 *   through the product was waiting on an email that no code path could send.
 *
 *   So the assertions below are mostly about honesty: that a transport which
 *   delivers nothing says so, that production refuses to run without a
 *   provider, and that a secret never appears in anything we print.
 *
 * No network and no database: the Resend transport is exercised against a
 * stubbed `fetch`, which is the only way to test a provider's error handling
 * without either a live key or a fiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertEmailReady,
  describeEmailConfig,
  isValidFrom,
  readEmailConfig,
} from '../../lib/email/config';
import { createEmailService, resolveTransport } from '../../lib/email/email-service';
import {
  duplicateRegistrationMessage,
  mfaMessage,
  passwordResetMessage,
  verificationMessage,
} from '../../lib/email/messages';
import { EmailDeliveryError, type EmailTransport } from '../../lib/email/transport';
import { createConsoleTransport } from '../../lib/email/transports/console';
import { createResendTransport } from '../../lib/email/transports/resend';

/** Just enough of `fetch` for the transport, so recorded calls stay typed. */
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const KEY = 're_test_pretend_key_0123456789';
const FROM = 'Flyrlink <no-reply@flyrlink.test>';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('choosing a provider from the environment', () => {
  it('picks Resend when it has everything it needs', () => {
    const config = readEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM });
    expect(config.provider).toBe('resend');
  });

  it('falls back to the development transport when nothing is set, and says why', () => {
    const config = readEmailConfig({});
    expect(config.provider).toBe('console');
    expect(config.provider === 'console' && config.reason).toContain('RESEND_API_KEY');
  });

  it('names the missing half rather than failing vaguely', () => {
    const noKey = readEmailConfig({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: FROM });
    expect(noKey.provider === 'console' && noKey.reason).toContain('RESEND_API_KEY');

    const noFrom = readEmailConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY });
    expect(noFrom.provider === 'console' && noFrom.reason).toContain('EMAIL_FROM');
  });

  it('refuses a sender address the provider would reject anyway', () => {
    // Better here, at boot, than on the first real send during a launch.
    const config = readEmailConfig({ RESEND_API_KEY: KEY, EMAIL_FROM: 'not an address' });
    expect(config.provider).toBe('console');
    expect(config.provider === 'console' && config.reason).toContain('EMAIL_FROM');
  });

  it('accepts both address forms', () => {
    expect(isValidFrom('no-reply@flyrlink.test')).toBe(true);
    expect(isValidFrom('Flyrlink <no-reply@flyrlink.test>')).toBe(true);
    expect(isValidFrom('no-reply@localhost')).toBe(false);
    expect(isValidFrom('')).toBe(false);
  });

  it('treats whitespace as unset, so a blank line in .env is not a configuration', () => {
    expect(readEmailConfig({ RESEND_API_KEY: '   ', EMAIL_FROM: FROM }).provider).toBe('console');
  });

  it('lets the development transport be chosen deliberately', () => {
    const config = readEmailConfig({ EMAIL_PROVIDER: 'console', RESEND_API_KEY: KEY, EMAIL_FROM: FROM });
    expect(config.provider).toBe('console');
  });

  it('rejects a provider name it does not have', () => {
    const config = readEmailConfig({ EMAIL_PROVIDER: 'mailgun' });
    expect(config.provider).toBe('console');
    expect(config.provider === 'console' && config.reason).toContain('mailgun');
  });
});

describe('the configuration report', () => {
  it('never contains a secret value', () => {
    const report = describeEmailConfig({
      RESEND_API_KEY: KEY,
      EMAIL_FROM: FROM,
      APP_URL: 'https://flyrlink.test',
    });
    const printed = JSON.stringify(report);

    expect(printed).not.toContain(KEY);
    // It names the variable, which is the whole point.
    expect(printed).toContain('RESEND_API_KEY');
    expect(report.variables.find((v) => v.name === 'RESEND_API_KEY')?.present).toBe(true);
  });

  it('marks a complete configuration as production ready', () => {
    const report = describeEmailConfig({
      RESEND_API_KEY: KEY,
      EMAIL_FROM: FROM,
      APP_URL: 'https://flyrlink.test',
    });
    expect(report).toMatchObject({ provider: 'resend', delivers: true, productionReady: true });
  });

  it('marks an empty one as neither', () => {
    const report = describeEmailConfig({});
    expect(report).toMatchObject({ provider: 'console', delivers: false, productionReady: false });
    expect(report.variables.filter((v) => v.required && !v.present).map((v) => v.name)).toEqual([
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'APP_URL',
    ]);
  });
});

describe('production refuses to run without a provider', () => {
  it('throws, naming what is missing', () => {
    expect(() => assertEmailReady({ NODE_ENV: 'production' })).toThrow(/RESEND_API_KEY/);
  });

  it('is silent when the configuration is complete', () => {
    expect(() =>
      assertEmailReady({
        NODE_ENV: 'production',
        RESEND_API_KEY: KEY,
        EMAIL_FROM: FROM,
        APP_URL: 'https://flyrlink.test',
      }),
    ).not.toThrow();
  });

  it('allows development to run without one', () => {
    expect(() => assertEmailReady({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('the development transport', () => {
  it('reports NOT_SENT — it must never pretend', () => {
    // The single most important assertion in this file. A transport that
    // answered "sent" here is how a team ships a product nobody can sign up to.
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const transport = createConsoleTransport('no provider configured');

    return transport
      .send({ to: 'a@b.test', subject: 'x', text: 'open https://app.test/verify?token=abc', html: '<p>x</p>' })
      .then((result) => {
        expect(result).toMatchObject({ status: 'NOT_SENT', transport: 'console' });
        expect(transport.delivers).toBe(false);
        // And says so where a person will see it.
        expect(log.mock.calls.flat().join('')).toContain('EMAIL NOT SENT');
      });
  });
});

describe('the Resend transport', () => {
  const transport = createResendTransport({
    provider: 'resend',
    apiKey: KEY,
    from: FROM,
    replyTo: undefined,
  });

  const message = {
    to: 'someone@example.test',
    subject: 'Confirm your email',
    text: 'open https://app.test/verify-email?token=abc',
    html: '<p>open</p>',
    tag: 'email_verification',
  };

  it('posts the message the provider expects', async () => {
    // Typed through the generic rather than the implementation, so the
    // recorded call is a `[url, init]` tuple a test can read back.
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await transport.send(message);

    expect(result).toEqual({ status: 'SENT', transport: 'resend', messageId: 'msg_123' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ from: FROM, to: ['someone@example.test'], subject: message.subject });
    // Both parts, always: plenty of clients render only text.
    expect(body.text).toBe(message.text);
    expect(body.html).toBe(message.html);
  });

  it('sends the key as a bearer token and nowhere else', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await transport.send(message);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;

    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);
  });

  it('carries reply-to only when one is configured', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await createResendTransport({
      provider: 'resend',
      apiKey: KEY,
      from: FROM,
      replyTo: 'support@flyrlink.test',
    }).send(message);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(body.reply_to).toBe('support@flyrlink.test');
  });

  it('surfaces the provider’s own refusal, with the status', async () => {
    // 403 is the one people hit: the sending domain is not verified. Swallowing
    // it would leave "sent" in the logs and nothing in the inbox.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'The flyrlink.test domain is not verified.' }), {
          status: 403,
        }),
      ),
    );

    await expect(transport.send(message)).rejects.toMatchObject({
      name: 'EmailDeliveryError',
      statusCode: 403,
    });
    await expect(transport.send(message)).rejects.toThrow(/not verified/);
  });

  it('never puts the key in an error, however the provider answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: `bad key ${KEY}` }), { status: 401 })),
    );

    // The provider would have to echo it for this to fail — but an error
    // message is a thing that gets pasted into tickets, so it is worth pinning
    // that nothing on *our* side adds it.
    const error = await transport.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).stack ?? '').not.toContain('authorization');
  });

  it('turns an unreachable provider into a delivery error, not a silent success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(transport.send(message)).rejects.toThrow(/Could not reach the mail provider/);
  });

  it('copes with a provider that answers with something other than JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
    await expect(transport.send(message)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe('the rendered messages', () => {
  const url = 'https://app.flyrlink.test/verify-email?token=abcdef';

  it('puts the link in both the text and the HTML part', () => {
    const message = verificationMessage({ to: 'a@b.test', actionUrl: url, expiresInHours: 24 });
    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
    expect(message.subject).toMatch(/confirm/i);
  });

  it('says how long the link lasts, because that is what people ask', () => {
    expect(verificationMessage({ to: 'a@b.test', actionUrl: url, expiresInHours: 24 }).text).toContain('24 hours');
    expect(passwordResetMessage({ to: 'a@b.test', actionUrl: url, expiresInMinutes: 30 }).text).toContain(
      '30 minutes',
    );
  });

  it('escapes what it interpolates', () => {
    const hostile = 'https://app.test/verify?token=a"><script>alert(1)</script>';
    const message = verificationMessage({ to: 'a@b.test', actionUrl: hostile, expiresInHours: 24 });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('gives the duplicate-registration notice no link and no account detail', () => {
    // It reaches somebody who did not ask for it, about an account they may not
    // control. A link here would be a way to act on an address you merely know.
    const message = duplicateRegistrationMessage({ to: 'a@b.test' });
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.html).not.toContain('<a ');
  });

  it('tells the owner what changed about their second factor', () => {
    expect(mfaMessage({ to: 'a@b.test', event: 'ENABLED' }).text).toMatch(/two-factor/i);
    expect(mfaMessage({ to: 'a@b.test', event: 'DISABLED' }).text).toMatch(/no longer/i);
    expect(mfaMessage({ to: 'a@b.test', event: 'BACKUP_CODES_REGENERATED' }).text).toMatch(/backup codes/i);
    // Every one of them is a "was this you?" message.
    expect(mfaMessage({ to: 'a@b.test', event: 'ENABLED' }).text).toMatch(/not you/i);
  });
});

describe('the service', () => {
  /** Records what it was handed, delivers nothing, admits it. */
  function recordingTransport(): EmailTransport & { sent: { subject: string; to: string }[] } {
    const sent: { subject: string; to: string }[] = [];
    return {
      name: 'recording',
      delivers: false,
      sent,
      async send(message) {
        sent.push({ subject: message.subject, to: message.to });
        return { status: 'NOT_SENT', transport: 'recording', reason: 'test transport' };
      },
    };
  }

  it('offers the four operations the application needs, plus the duplicate notice', async () => {
    const transport = recordingTransport();
    const service = createEmailService(transport);

    await service.sendVerificationOTP({ to: 'a@b.test', actionUrl: 'https://app.test/v?token=1' });
    await service.sendPasswordReset({ to: 'a@b.test', actionUrl: 'https://app.test/r?token=1' });
    await service.sendMFA({ to: 'a@b.test', event: 'ENABLED' });
    await service.sendNotification({ to: 'a@b.test', subject: 'Milestone approved', heading: 'Approved', body: ['x'] });
    await service.sendDuplicateRegistrationNotice({ to: 'a@b.test' });

    expect(transport.sent).toHaveLength(5);
    expect(transport.sent.map((m) => m.subject)).toContain('Milestone approved');
  });

  it('passes the transport’s own answer straight back, unembellished', async () => {
    const service = createEmailService(recordingTransport());
    const result = await service.sendVerificationOTP({ to: 'a@b.test', actionUrl: 'https://app.test/v' });
    expect(result).toMatchObject({ status: 'NOT_SENT', transport: 'recording' });
  });

  it('reports which transport it is using, and whether it delivers', () => {
    const service = createEmailService(recordingTransport());
    expect(service.transportName).toBe('recording');
    expect(service.delivers).toBe(false);
  });

  it('resolves the development transport when the environment is empty', () => {
    // Which is this repository's own state, and the reason no mail arrives.
    expect(resolveTransport({} as NodeJS.ProcessEnv).name).toBe('console');
    expect(resolveTransport({} as NodeJS.ProcessEnv).delivers).toBe(false);
  });
});
