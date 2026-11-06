'use client';

/**
 * Two-phase MFA enrollment, against the existing endpoints.
 *
 *   POST  /api/auth/mfa/enroll   issues a secret; MFA is NOT yet on
 *   PATCH /api/auth/mfa/enroll   proves a code, then turns it on
 *
 * The second phase is what makes this safe: without proving a code first, a
 * person could enable MFA with a secret their authenticator never received and
 * lock themselves out of a privileged account. This screen never skips it, and
 * could not — the server does the deciding.
 *
 * WHAT IS NEVER DONE WITH THE SECRET
 *   It is held in React state for the length of the setup and nowhere else. Not
 *   in `localStorage`, not in `sessionStorage`, not in a query string, not in a
 *   URL a QR image would be fetched from, and not in a log line. It is rendered
 *   twice — as a QR code and as selectable text — and both are in the document,
 *   which is where it has to be for anyone to enrol at all.
 *
 * AFTER SUCCESS
 *   Turning MFA on revokes every session, including this one. So the last step
 *   is not "done" but "here are your backup codes, now sign in again" — and the
 *   codes are shown once, because only their digests are kept.
 */

import { useState } from 'react';

import { QrCode } from '../../../../../components/auth/qr-code';
import { Button } from '../../../../../components/ui/button';
import { Field, FormError } from '../../../../../components/ui/field';
import { OtpInput } from '../../../../../components/ui/otp-input';
import { type ApiFailure, api, fieldError } from '../../../../../lib/ui/api';

interface Started {
  readonly secret: string;
  readonly otpauthUri: string;
}

type Stage =
  | { readonly step: 'IDLE' }
  | { readonly step: 'SCAN'; readonly started: Started }
  | { readonly step: 'DONE'; readonly backupCodes: readonly string[] };

/** A refusal, said in one sentence. `null` means the server's own is better. */
function explain(error: ApiFailure): string | null {
  switch (error.code) {
    case 'MFA_ALREADY_ENABLED':
      return 'Two-factor authentication is already on for this account. Reload the page to see its current state.';
    case 'MFA_NOT_ENROLLING':
      return 'This setup has expired. Start again to get a fresh code.';
    case 'MFA_CODE_INVALID':
      return 'That code is not correct. Check your app is showing the current one and try again.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Sign in again to continue.';
    case 'ACCOUNT_INACTIVE':
      return 'This account is not active. Contact your administrator.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'NETWORK':
      return error.message;
    default:
      return null;
  }
}

export function MfaEnrollment({
  alreadyEnabled,
  required,
  email,
}: {
  readonly alreadyEnabled: boolean;
  readonly required: boolean;
  readonly email: string;
}) {
  const [stage, setStage] = useState<Stage>({ step: 'IDLE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const card = 'flex flex-col gap-6 rounded-card bg-white p-7 shadow-card ring-1 ring-line';

  // ------------------------------------------------------------------ enabled
  // Nothing to do, and no way to turn it off from here: disabling requires a
  // password and a code, and is refused outright for a privileged role.
  if (alreadyEnabled && stage.step !== 'DONE') {
    return (
      <section className={card} aria-labelledby="mfa-state">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-positive-soft px-3 py-1 text-[12px] font-semibold text-positive">
            On
          </span>
          <h2 id="mfa-state" className="text-lg font-semibold tracking-[-0.01em] text-ink">
            Two-factor authentication is set up
          </h2>
        </div>
        <p className="text-[14px] leading-relaxed text-ink-muted">
          You will be asked for a code from your authenticator app each time you sign in. Your role
          requires it, so it cannot be switched off from here.
        </p>
        <div>
          <a
            href="/dashboard"
            className="text-[14px] font-semibold text-brand-600 hover:text-brand-700"
          >
            Back to your dashboard
          </a>
        </div>
      </section>
    );
  }

  // --------------------------------------------------------------------- idle
  async function begin(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await api<Started>('/api/auth/mfa/enroll', { method: 'POST' });
    setBusy(false);
    if (result.ok) setStage({ step: 'SCAN', started: result.data });
    else setError(result.error);
  }

  // --------------------------------------------------------------------- scan
  async function confirm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api<{ backupCodes: string[] }>('/api/auth/mfa/enroll', {
      method: 'PATCH',
      body: { code: String(form.get('code') ?? '').trim() },
    });

    setBusy(false);
    if (result.ok) setStage({ step: 'DONE', backupCodes: result.data.backupCodes });
    else setError(result.error);
  }

  if (stage.step === 'DONE') {
    return (
      <section className={card} aria-labelledby="mfa-done">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-positive-soft px-3 py-1 text-[12px] font-semibold text-positive">
            Enabled
          </span>
          <h2 id="mfa-done" className="text-lg font-semibold tracking-[-0.01em] text-ink">
            Two-factor authentication is on
          </h2>
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-amber-50 p-5 ring-1 ring-amber-200 ring-inset">
          <h3 className="text-[15px] font-semibold text-amber-900">
            Save these backup codes now
          </h3>
          <p className="text-[13px] leading-relaxed text-amber-800">
            Each one works once, in place of a code from your app. They are shown here and nowhere
            else — only their digests are kept, so they cannot be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 pt-1 font-mono text-[14px] tracking-[0.1em] text-amber-900 sm:grid-cols-3">
            {stage.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>

        <p className="text-[14px] leading-relaxed text-ink-muted">
          Turning this on signed out every session, including this one. Sign in again and you will
          be asked for a code.
        </p>

        <div>
          <a href="/login" className="inline-flex">
            <Button size="lg">Sign in again</Button>
          </a>
        </div>
      </section>
    );
  }

  if (stage.step === 'SCAN') {
    const { secret, otpauthUri } = stage.started;
    return (
      <section className={card} aria-labelledby="mfa-scan">
        <h2 id="mfa-scan" className="text-lg font-semibold tracking-[-0.01em] text-ink">
          Add Flyrlink to your authenticator app
        </h2>

        <ol className="flex flex-col gap-6">
          <li className="flex flex-col gap-3">
            <p className="text-[14px] leading-relaxed text-ink">
              <span className="font-semibold">1.</span> Scan this with your authenticator app.
            </p>
            <div className="w-fit rounded-xl bg-white p-3 ring-1 ring-line">
              <QrCode
                value={otpauthUri}
                label={`QR code enrolling ${email} in two-factor authentication`}
                className="size-44"
              />
            </div>
          </li>

          <li className="flex flex-col gap-2">
            <p className="text-[14px] leading-relaxed text-ink">
              <span className="font-semibold">2.</span> Or type this key in by hand, if you cannot
              scan.
            </p>
            <code className="w-fit rounded-lg bg-canvas-subtle px-3 py-2 font-mono text-[14px] tracking-[0.14em] break-all text-ink select-all">
              {secret}
            </code>
          </li>

          <li className="flex flex-col gap-2">
            <p className="text-[14px] leading-relaxed text-ink">
              <span className="font-semibold">3.</span> Enter the six-digit code it shows.
            </p>

            <form method="post" onSubmit={confirm} className="flex flex-col gap-5 pt-1" noValidate>
              <Field id="code" label="Code from your app" error={fieldError(error, 'code')}>
                <OtpInput id="code" name="code" autoFocus disabled={busy} invalid={Boolean(error)} />
              </Field>

              <FormError
                message={
                  error ? (explain(error) ?? (error.details ? null : error.message)) : null
                }
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={busy}>
                  {busy ? 'Checking…' : 'Turn on two-factor'}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setStage({ step: 'IDLE' });
                    setError(null);
                  }}
                  disabled={busy}
                  className="cursor-pointer text-[13px] text-ink-subtle hover:text-ink disabled:opacity-60"
                >
                  Start over
                </button>
              </div>
            </form>
          </li>
        </ol>
      </section>
    );
  }

  // --------------------------------------------------------------------- idle
  return (
    <section className={card} aria-labelledby="mfa-start">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={
            required
              ? 'rounded-full bg-amber-100 px-3 py-1 text-[12px] font-semibold text-amber-800'
              : 'rounded-full bg-canvas-subtle px-3 py-1 text-[12px] font-semibold text-ink-subtle'
          }
        >
          {required ? 'Required' : 'Off'}
        </span>
        <h2 id="mfa-start" className="text-lg font-semibold tracking-[-0.01em] text-ink">
          {required ? 'Set this up to use your role' : 'Add a second factor'}
        </h2>
      </div>

      <p className="text-[14px] leading-relaxed text-ink-muted">
        You will need an authenticator app — 1Password, Google Authenticator, Authy, or any other
        TOTP app. Setting this up signs out every session, including this one, so you will sign in
        again at the end.
      </p>

      <FormError message={error ? (explain(error) ?? error.message) : null} />

      <div>
        <Button size="lg" onClick={begin} disabled={busy}>
          {busy ? 'Starting…' : 'Enable two-factor'}
        </Button>
      </div>
    </section>
  );
}
