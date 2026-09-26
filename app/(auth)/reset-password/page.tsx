'use client';

/**
 * `/reset-password` — where the link in the reset email lands.
 *
 * Like `/verify-email`, this page did not exist and the email pointed at it,
 * so the whole recovery path ended in a 404.
 *
 * WHY THE TOKEN IS NOT SENT UNTIL SUBMIT
 *   It arrives in the query string — it has to, it came from an email — but it
 *   is only read, never echoed into a new URL, a log line, or a referrer. The
 *   page does not consume it on load either: a reset token is single-use and a
 *   mail scanner opening the link would burn it before the person arrived.
 *   Nothing happens until a password is typed.
 *
 * WHAT HAPPENS AFTER
 *   Every session is revoked, including any the attacker holds — a reset is
 *   the recovery path for a compromised account, so it has to be. The person
 *   signs in again, which is why this ends at `/login` rather than a dashboard.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../lib/ui/api';

function ResetPassword() {
  const token = useSearchParams().get('token');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const card = 'flex flex-col gap-5 rounded-card bg-white p-8 shadow-card ring-1 ring-line';

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get('confirm') ?? '');

    // Checked here because only this page knows there are two boxes — the API
    // takes one password and is right to. Everything else is the server's call.
    if (password !== confirmation) {
      setError({
        code: 'PASSWORDS_DIFFER',
        message: 'Those two passwords are not the same.',
        status: 0,
      });
      return;
    }

    setBusy(true);
    setError(null);

    const result = await api('/api/auth/password/reset', {
      method: 'POST',
      body: { token, password },
    });

    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.error);
  }

  if (!token) {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">No reset link</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Open the link from your reset email, or ask for a new one.
        </p>
        <a href="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Ask for a reset link
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Password changed</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Every device has been signed out, including any you did not recognise. Sign in with your
          new password.
        </p>
        <div>
          <a href="/login" className="inline-flex">
            <Button size="lg">Sign in</Button>
          </a>
        </div>
      </div>
    );
  }

  const expired = error?.code === 'TOKEN_INVALID_OR_EXPIRED';

  return (
    <div className={card}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Choose a new password</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Setting it signs out every device.
        </p>
      </div>

      <form method="post" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field
          id="password"
          label="New password"
          hint="At least 12 characters. A memorable phrase beats a short, clever one."
          error={fieldError(error, 'password')}
        >
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            invalid={Boolean(fieldError(error, 'password'))}
          />
        </Field>

        <Field
          id="confirm"
          label="Repeat it"
          error={error?.code === 'PASSWORDS_DIFFER' ? error.message : undefined}
        >
          <TextInput
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            invalid={error?.code === 'PASSWORDS_DIFFER'}
          />
        </Field>

        <FormError
          message={error && !error.details && error.code !== 'PASSWORDS_DIFFER' ? error.message : null}
        />

        {expired ? (
          <a href="/forgot-password" className="text-[14px] font-semibold text-brand-600 hover:text-brand-700">
            Ask for a new reset link
          </a>
        ) : null}

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}
