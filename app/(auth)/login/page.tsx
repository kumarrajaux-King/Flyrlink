'use client';

/**
 * `/login` — the password half of signing in.
 *
 * The second factor lives at `/login/mfa`, not as a stage on this page. It was
 * a stage once, and a refresh mid-challenge dropped the person back onto the
 * credentials form with a live session cookie already set — asking again for a
 * password they had just proven. A URL survives a refresh; React state does
 * not.
 *
 * Which of the three destinations is right is not decided here. `login`
 * answers with `mfaRequired`, and `/login/mfa` re-reads the session
 * server-side and routes from what it finds — so a stale or tampered answer
 * from this page changes nothing.
 *
 * A failed sign-in never says which half was wrong. The server answers
 * `INVALID_CREDENTIALS` for both, and this page repeats it rather than
 * improving on it.
 *
 * `method="post"` is not decoration. A `<form>` with no method is a GET, and
 * until React has hydrated there is no `onSubmit` to call `preventDefault` —
 * so a submit in that window was a real browser navigation to
 * `/login?email=…&password=…`. That puts the password in the address bar, in
 * browser history, and in every access log along the way. It is a narrow race,
 * and a race is not a defence; it was caught by a browser test clicking faster
 * than hydration, which is exactly what a person on a slow connection does.
 * POST keeps the credentials in a body whatever happens.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../lib/ui/api';
import { MFA_CHALLENGE_PATH, safeNext } from '../../../lib/ui/auth-routes';

function LoginForm() {
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

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    // A full navigation either way — the cookie just changed, so nothing
    // rendered before it is still valid. `/login/mfa` decides between the
    // challenge, enrollment, and passing straight through; it does not take
    // this page's word for it.
    window.location.assign(
      result.data.mfaRequired ? `${MFA_CHALLENGE_PATH}?next=${encodeURIComponent(next)}` : next,
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

      <form method="post" onSubmit={signIn} className="flex flex-col gap-5" noValidate>
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[13px]">
        <a href="/forgot-password" className="font-semibold text-brand-600 hover:text-brand-700">
          Forgot your password?
        </a>
        {/*
          The way back for somebody whose 24-hour verification link lapsed. It
          was a dead end: the account cannot sign in, and registering again
          fails on the unique email.
        */}
        <a href="/verify-email" className="text-ink-subtle hover:text-ink">
          Need a new verification link?
        </a>
      </div>
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
