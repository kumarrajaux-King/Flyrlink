/**
 * Which mail provider this deployment has, read from the environment.
 *
 * NOTHING HERE EVER RETURNS OR LOGS A SECRET VALUE.
 *   `describeEmailConfig` reports variable *names* and whether each is set.
 *   That is enough to diagnose "why is no mail arriving" without putting an API
 *   key in a terminal, a CI log, a screenshot or a support ticket. The key
 *   itself is only ever read inside the transport that needs it.
 *
 * WHY `EMAIL_API_KEY` IS GONE
 *   It was a placeholder for an adapter that was never written, so nothing read
 *   it. A variable that looks configured and does nothing is worse than an
 *   absent one: it is exactly the state that makes somebody believe mail is
 *   being sent. The names are now provider-specific, so setting one means
 *   something.
 */

export const EMAIL_PROVIDERS = ['resend', 'console'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

export type EmailConfig =
  | {
      readonly provider: 'resend';
      readonly apiKey: string;
      readonly from: string;
      readonly replyTo: string | undefined;
    }
  | {
      /** DEV ONLY. Delivers nothing, and says so. */
      readonly provider: 'console';
      /** Why we fell back here. Shown in diagnostics. */
      readonly reason: string;
    };

type Env = Record<string, string | undefined>;

const trim = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * A `From` that a provider will accept.
 *
 * Both `you@example.com` and `Name <you@example.com>` are valid; anything else
 * is rejected here rather than by the provider on the first real send, which is
 * usually during a launch.
 */
export function isValidFrom(from: string): boolean {
  const address = /<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>\s*$/.exec(from)?.[1] ?? from;
  return /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(address.trim());
}

/**
 * Resolve the provider.
 *
 * `EMAIL_PROVIDER` is explicit when set. Otherwise a complete Resend
 * configuration selects Resend, and anything else falls back to the console
 * transport — which `assertEmailReady` then refuses in production.
 */
export function readEmailConfig(env: Env = process.env): EmailConfig {
  const requested = trim(env.EMAIL_PROVIDER)?.toLowerCase();
  const apiKey = trim(env.RESEND_API_KEY);
  const from = trim(env.EMAIL_FROM);
  const replyTo = trim(env.EMAIL_REPLY_TO);

  if (requested === 'console') {
    return { provider: 'console', reason: 'EMAIL_PROVIDER is set to "console".' };
  }

  const wantsResend = requested === 'resend' || (!requested && Boolean(apiKey && from));

  if (wantsResend) {
    const missing: string[] = [];
    if (!apiKey) missing.push('RESEND_API_KEY');
    if (!from) missing.push('EMAIL_FROM');
    if (missing.length > 0) {
      return {
        provider: 'console',
        reason: `Resend is selected but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
      };
    }
    if (!isValidFrom(from!)) {
      return {
        provider: 'console',
        reason: 'EMAIL_FROM is not a valid address. Use "you@yourdomain.com" or "Name <you@yourdomain.com>".',
      };
    }
    return { provider: 'resend', apiKey: apiKey!, from: from!, replyTo };
  }

  if (requested && !EMAIL_PROVIDERS.includes(requested as EmailProviderName)) {
    return {
      provider: 'console',
      reason: `EMAIL_PROVIDER="${requested}" is not one of: ${EMAIL_PROVIDERS.join(', ')}.`,
    };
  }

  return {
    provider: 'console',
    reason: 'No mail provider is configured. Set RESEND_API_KEY and EMAIL_FROM.',
  };
}

export interface EmailVariableReport {
  readonly name: string;
  readonly required: boolean;
  readonly present: boolean;
  readonly note: string;
}

export interface EmailConfigReport {
  readonly provider: EmailProviderName;
  /** True when real mail would actually leave this deployment. */
  readonly delivers: boolean;
  /** True when this configuration is fit for production. */
  readonly productionReady: boolean;
  readonly reason: string | null;
  readonly variables: readonly EmailVariableReport[];
}

/**
 * A description of the mail configuration with no secret in it.
 *
 * Safe to print, paste into an issue, and run in production.
 */
export function describeEmailConfig(env: Env = process.env): EmailConfigReport {
  const config = readEmailConfig(env);
  const present = (name: string): boolean => Boolean(trim(env[name]));

  const variables: EmailVariableReport[] = [
    {
      name: 'EMAIL_PROVIDER',
      required: false,
      present: present('EMAIL_PROVIDER'),
      note: `Optional. One of: ${EMAIL_PROVIDERS.join(', ')}. Inferred when unset.`,
    },
    {
      name: 'RESEND_API_KEY',
      required: true,
      present: present('RESEND_API_KEY'),
      note: 'The Resend API key. Required for any real delivery.',
    },
    {
      name: 'EMAIL_FROM',
      required: true,
      present: present('EMAIL_FROM'),
      note: 'Sender address on a domain verified with the provider.',
    },
    {
      name: 'EMAIL_REPLY_TO',
      required: false,
      present: present('EMAIL_REPLY_TO'),
      note: 'Optional. Where replies go, if not the sender.',
    },
    {
      name: 'APP_URL',
      required: true,
      present: present('APP_URL'),
      note: 'Absolute base for links in emails. A wrong value sends people to the wrong host.',
    },
  ];

  return {
    provider: config.provider,
    delivers: config.provider !== 'console',
    productionReady: config.provider !== 'console' && present('APP_URL'),
    reason: config.provider === 'console' ? config.reason : null,
    variables,
  };
}

/**
 * Refuse to run a production deployment that cannot send mail.
 *
 * Verification and password reset are load-bearing: an account that cannot be
 * verified cannot be used, and a password that cannot be reset is an account
 * lost. Failing at boot is far better than discovering it one signup at a time.
 */
export function assertEmailReady(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const report = describeEmailConfig(env);
  if (report.productionReady) return;

  const missing = report.variables
    .filter((variable) => variable.required && !variable.present)
    .map((variable) => variable.name);

  throw new Error(
    `Email is not configured for production: ${report.reason ?? 'incomplete configuration'}` +
      (missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : ''),
  );
}
