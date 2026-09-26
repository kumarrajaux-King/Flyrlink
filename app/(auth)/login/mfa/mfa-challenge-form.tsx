'use client';

/**
 * The second-factor challenge.
 *
 * Talks to `POST /api/auth/mfa/verify` and nothing else. The session cookie is
 * already set at this point — sign-in succeeded — and the session simply has
 * not cleared its factor yet, so it can reach the verify endpoint and nothing
 * else. That is enforced by `authorize` on the server; this form does not and
 * cannot decide it.
 *
 * ON REFUSALS
 *   Every state below is the server's own answer, mapped to a sentence. The
 *   page never invents one, never counts attempts itself, and never says which
 *   part of a failure was wrong: `MFA_CODE_INVALID` covers a mistyped code, an
 *   expired one and a replayed one, deliberately, because distinguishing them
 *   tells an attacker which half to keep.
 */

import { useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Field, FormError } from '../../../../components/ui/field';
import { OtpInput, type OtpMode } from '../../../../components/ui/otp-input';
import { type ApiFailure, api, fieldError } from '../../../../lib/ui/api';

/**
 * A refusal, said in one sentence.
 *
 * Returning `null` for a code means "the server's own message is the right
 * one" — usually a validation detail naming the field.
 */
function explain(error: ApiFailure): { readonly message: string; readonly recover?: 'SIGN_IN' | 'ENROL' } | null {
  switch (error.code) {
    case 'MFA_CODE_INVALID':
      return { message: 'That code is not correct, or it has already been used. Try the next one your app shows.' };
    case 'MFA_NOT_ENABLED':
      // The factor was removed, or this account never had one, so there is
      // nothing to answer with.
      return { message: 'This account has no second factor set up.', recover: 'ENROL' };
    case 'UNAUTHENTICATED':
      return { message: 'Your session has expired. Sign in again to continue.', recover: 'SIGN_IN' };
    case 'ACCOUNT_INACTIVE':
      return { message: 'This account is not active. Contact your administrator.', recover: 'SIGN_IN' };
    case 'RATE_LIMITED':
      return { message: 'Too many attempts. Wait a minute, then try again.' };
    case 'NETWORK':
      return { message: error.message };
    default:
      return null;
  }
}

export function MfaChallengeForm({ next, email }: { readonly next: string; readonly email: string }) {
  const [mode, setMode] = useState<OtpMode>('numeric');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const explained = error ? explain(error) : null;
  const numeric = mode === 'numeric';

  async function verify(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const entered = String(form.get('code') ?? '').trim();

    setBusy(true);
    setError(null);

    // Two different fields on the endpoint: a TOTP code and a backup code are
    // checked by different paths, and sending one as the other always fails.
    const result = await api('/api/auth/mfa/verify', {
      method: 'POST',
      body: numeric ? { code: entered } : { backupCode: entered },
    });

    if (result.ok) {
      // A full navigation, not a router push: the session's authority just
      // changed, so every server component cached for it has to be discarded.
      window.location.assign(next);
      return;
    }

    setBusy(false);
    setError(result.error);
  }

  /** Abandon the challenge: drop the half-finished session rather than leave it. */
  async function cancel(): Promise<void> {
    setBusy(true);
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  return (
    <div className="flex flex-col gap-6 rounded-card bg-white p-8 shadow-card ring-1 ring-line">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Confirm it is you</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          {numeric
            ? 'Enter the six-digit code from your authenticator app.'
            : 'Enter one of the backup codes you saved when you set this up.'}
        </p>
        <p className="text-[13px] text-ink-subtle">
          Signed in as <span className="font-medium text-ink-muted">{email}</span>
        </p>
      </div>

      <form method="post" onSubmit={verify} className="flex flex-col gap-5" noValidate>
        <Field
          id="code"
          label={numeric ? 'Authentication code' : 'Backup code'}
          error={fieldError(error, numeric ? 'code' : 'backupCode')}
        >
          {/*
            Remounted when the mode changes — `key` — so the field is cleared
            and refocused rather than carrying a six-digit code into a field
            that wants a backup code.
          */}
          <OtpInput
            key={mode}
            id="code"
            name="code"
            mode={mode}
            autoFocus
            disabled={busy}
            invalid={Boolean(error)}
          />
        </Field>

        <FormError message={explained?.message ?? (error && !error.details ? error.message : null)} />

        {explained?.recover === 'SIGN_IN' ? (
          <a href="/login" className="text-[14px] font-semibold text-brand-600 hover:text-brand-700">
            Go to sign in
          </a>
        ) : null}
        {explained?.recover === 'ENROL' ? (
          <a
            href="/dashboard/security/mfa"
            className="text-[14px] font-semibold text-brand-600 hover:text-brand-700"
          >
            Set up a second factor
          </a>
        ) : null}

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Checking…' : 'Verify'}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[13px]">
        <button
          type="button"
          onClick={() => {
            setMode(numeric ? 'backup' : 'numeric');
            setError(null);
          }}
          className="cursor-pointer font-semibold text-brand-600 hover:text-brand-700"
        >
          {numeric ? 'Use a backup code instead' : 'Use my authenticator app'}
        </button>

        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="cursor-pointer text-ink-subtle hover:text-ink disabled:opacity-60"
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}
