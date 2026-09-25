'use client';

/**
 * `/login` — sign in, and answer the MFA challenge when one is required.
 *
 * Both steps live on one page because they are one act. `login` answers with
 * `mfaRequired`, and the session cookie is already set at that point — the
 * session simply has not satisfied its second factor yet, so it can reach the
 * verify endpoint and nothing else. Sending the person to a second URL would
 * add a place for the flow to be lost on a refresh.
 *
 * A failed sign-in never says which half was wrong. The server answers
 * `INVALID_CREDENTIALS` for both, and this page repeats it rather than
 * improving on it.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../lib/ui/api';

/**
 * Only a same-origin path is followed, so `?next=` cannot send anyone offsite.
 *
 * The default is `/dashboard`, which resolves the role server-side and
 * forwards from there — so this page never has to know what a role means.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

function LoginForm() {
  const [stage, setStage] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const next = safeNext(useSearchParams().get('next'));

  async function signIn(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api<{ mfaRequired: boolean }>('/api/auth/login', {
      method: 'POST',
      body: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.mfaRequired) setStage('MFA');
    else window.location.assign(next);
  }

  async function verify(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api('/api/auth/mfa/verify', {
      method: 'POST',
      body: { code: String(form.get('code') ?? '').trim() },
    });

    setBusy(false);
    if (result.ok) window.location.assign(next);
    else setError(result.error);
  }

  if (stage === 'MFA') {
    return (
      <div className="flex flex-col gap-6 rounded-card bg-white p-8 shadow-card ring-1 ring-line">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Confirm it is you</h1>
          <p className="text-[15px] leading-relaxed text-ink-muted">
            Enter the six-digit code from your authenticator app.
          </p>
        </div>

        <form onSubmit={verify} className="flex flex-col gap-5" noValidate>
          <Field id="code" label="Authentication code" error={fieldError(error, 'code')}>
            <TextInput
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              required
              autoFocus
              placeholder="123456"
              className="text-center text-lg tracking-[0.4em] tabular-nums"
              invalid={Boolean(error)}
            />
          </Field>

          <FormError message={error && !error.details ? error.message : null} />

          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </Button>

          <p className="text-[13px] leading-relaxed text-ink-subtle">
            A backup code works here too, if you cannot reach the app.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-card bg-white p-8 shadow-card ring-1 ring-line">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Sign in</h1>
        <p className="text-[15px] text-ink-muted">
          New here?{' '}
          <a href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            Create an account
          </a>
          .
        </p>
      </div>

      <form onSubmit={signIn} className="flex flex-col gap-5" noValidate>
        <Field id="email" label="Email" error={fieldError(error, 'email')}>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            invalid={Boolean(fieldError(error, 'email'))}
            placeholder="you@company.com"
          />
        </Field>

        <Field id="password" label="Password" error={fieldError(error, 'password')}>
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            invalid={Boolean(fieldError(error, 'password'))}
          />
        </Field>

        <FormError message={error && !error.details ? error.message : null} />

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
