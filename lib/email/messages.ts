/**
 * What each transactional email says.
 *
 * Plain and short on purpose. These are functional messages sent at a moment
 * when somebody is trying to do one specific thing, and the thing they need is
 * a link and a sentence saying what it does. Everything else is in the way.
 *
 * Every message carries a text part as well as HTML. Plenty of clients render
 * only text, spam filters look for it, and a link nobody can reach is the whole
 * failure this module exists to avoid.
 *
 * NOTHING HERE DECIDES ANYTHING. These are pure functions from parameters to a
 * rendered message, so they can be read, diffed and tested without a provider.
 */

import type { EmailMessage } from './transport';

/** The product name as it appears to a recipient. */
const PRODUCT = 'Flyrlink';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One layout for every message.
 *
 * Inline styles and a table-free single column: email clients have no cascade
 * worth relying on, and anything cleverer renders differently in each of them.
 */
function layout(parts: {
  heading: string;
  body: readonly string[];
  action?: { label: string; url: string } | undefined;
  footer?: string | undefined;
}): string {
  const paragraphs = parts.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2b4557;">${escapeHtml(line)}</p>`,
    )
    .join('');

  const button = parts.action
    ? `<p style="margin:0 0 20px;">
         <a href="${escapeHtml(parts.action.url)}"
            style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1668c7;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
           ${escapeHtml(parts.action.label)}
         </a>
       </p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#5c7285;">
         If the button does not work, paste this into your browser:<br>
         <span style="word-break:break-all;">${escapeHtml(parts.action.url)}</span>
       </p>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;">
    <p style="margin:0 0 24px;font-size:15px;font-weight:700;color:#0c2738;">${PRODUCT}</p>
    <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0c2738;">${escapeHtml(parts.heading)}</h1>
    ${paragraphs}
    ${button}
    ${parts.footer ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e4ebf1;font-size:13px;line-height:1.6;color:#5c7285;">${escapeHtml(parts.footer)}</p>` : ''}
  </div>
</body></html>`;
}

function plain(parts: {
  heading: string;
  body: readonly string[];
  action?: { label: string; url: string } | undefined;
  footer?: string | undefined;
}): string {
  return [
    parts.heading,
    '',
    ...parts.body,
    ...(parts.action ? ['', `${parts.action.label}: ${parts.action.url}`] : []),
    ...(parts.footer ? ['', parts.footer] : []),
    '',
    `— ${PRODUCT}`,
  ].join('\n');
}

function render(
  to: string,
  tag: string,
  subject: string,
  parts: {
    heading: string;
    body: readonly string[];
    action?: { label: string; url: string } | undefined;
    footer?: string | undefined;
  },
): EmailMessage {
  return { to, subject, tag, text: plain(parts), html: layout(parts) };
}

export function verificationMessage(params: {
  to: string;
  actionUrl: string;
  expiresInHours: number;
}): EmailMessage {
  const parts = {
    heading: 'Confirm your email address',
    body: [
      `Open the link below to activate your ${PRODUCT} account.`,
      `It works once, and expires in ${params.expiresInHours} hours.`,
    ],
    action: { label: 'Verify my email', url: params.actionUrl },
    footer: 'If you did not create an account, ignore this — nothing happens until the link is opened.',
  };
  return render(params.to, 'email_verification', `Confirm your ${PRODUCT} email address`, parts);
}

export function passwordResetMessage(params: {
  to: string;
  actionUrl: string;
  expiresInMinutes: number;
}): EmailMessage {
  const parts = {
    heading: 'Reset your password',
    body: [
      'Open the link below to choose a new password.',
      `It works once, and expires in ${params.expiresInMinutes} minutes. Using it signs out every device.`,
    ],
    action: { label: 'Choose a new password', url: params.actionUrl },
    footer:
      'If you did not ask for this, ignore it — your password stays as it is, and the link expires on its own.',
  };
  return render(params.to, 'password_reset', `Reset your ${PRODUCT} password`, parts);
}

/**
 * Sent to the owner of an address somebody tried to register again.
 *
 * Deliberately carries no link and no account detail. Registration answers the
 * same way whether or not an address is taken, so this is the only channel that
 * reaches the genuine owner — and it must not become a way to act on an account
 * you merely know the address of.
 */
export function duplicateRegistrationMessage(params: { to: string }): EmailMessage {
  const parts = {
    heading: 'Someone tried to sign up with your email',
    body: [
      `An account already exists for this address, so nothing was created.`,
      'If that was you, sign in as usual, or reset your password if you have forgotten it.',
    ],
    footer: 'If it was not you, no action is needed. Nobody gained access to anything.',
  };
  return render(params.to, 'duplicate_registration', `About your ${PRODUCT} account`, parts);
}

export type MfaEvent = 'ENABLED' | 'DISABLED' | 'BACKUP_CODES_REGENERATED';

/**
 * A security notice about the second factor.
 *
 * Every one of these is "something changed on your account" — the kind of
 * change whose whole point is that the owner finds out even when they were not
 * the one who made it.
 */
export function mfaMessage(params: { to: string; event: MfaEvent }): EmailMessage {
  const copy: Record<MfaEvent, { heading: string; body: string[] }> = {
    ENABLED: {
      heading: 'Two-factor authentication is on',
      body: [
        'Your account now asks for a code from your authenticator app each time you sign in.',
        'Every device was signed out as part of the change.',
      ],
    },
    DISABLED: {
      heading: 'Two-factor authentication is off',
      body: [
        'Your account no longer asks for a code from your authenticator app.',
        'Every device was signed out as part of the change.',
      ],
    },
    BACKUP_CODES_REGENERATED: {
      heading: 'Your backup codes were replaced',
      body: [
        'A new set of backup codes was generated. The previous set no longer works.',
        'If you did not do this, your account may be compromised.',
      ],
    },
  };

  const chosen = copy[params.event];
  const parts = {
    heading: chosen.heading,
    body: chosen.body,
    footer: 'If this was not you, reset your password immediately and contact support.',
  };
  return render(params.to, `mfa_${params.event.toLowerCase()}`, `${PRODUCT} security: ${chosen.heading.toLowerCase()}`, parts);
}

export function notificationMessage(params: {
  to: string;
  subject: string;
  heading: string;
  body: readonly string[];
  action?: { label: string; url: string } | undefined;
  tag?: string | undefined;
}): EmailMessage {
  const parts = {
    heading: params.heading,
    body: params.body,
    action: params.action,
  };
  return render(params.to, params.tag ?? 'notification', params.subject, parts);
}
