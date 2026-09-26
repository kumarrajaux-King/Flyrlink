'use client';

/**
 * `/verify-email` — where the link in the registration email lands.
 *
 * This page did not exist, and the email pointed at it: every account created
 * through the product reached a 404 and could never be activated. The endpoint
 * behind it has been there and tested since Phase 4; nothing could reach it.
 *
 * WHY THE TOKEN IS CONSUMED BY A POST FROM HERE
 *   The obvious alternative is a GET route that verifies on visit. It is worse:
 *   mail clients and security scanners fetch links before a person ever sees
 *   them, so a single-use token gets spent by a robot and the real recipient
 *   opens a dead link. A POST from the page is not pre-fetched.
 *
 *   `useRef` guards against React running the effect twice in development
 *   Strict Mode, which would consume the token and then report it already used.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api } from '../../../lib/ui/api';

type State =
  | { readonly step: 'CHECKING' }
  | { readonly step: 'VERIFIED'; readonly alreadyVerified: boolean }
  | { readonly step: 'NO_TOKEN' }
  | { readonly step: 'FAILED'; readonly error: ApiFailure };

function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? { step: 'CHECKING' } : { step: 'NO_TOKEN' });
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      const result = await api<{ verified: boolean; alreadyVerified?: boolean }>(
        '/api/auth/verify-email',
        { method: 'POST', body: { token } },
      );
      setState(
        result.ok
          ? { step: 'VERIFIED', alreadyVerified: Boolean(result.data.alreadyVerified) }
          : { step: 'FAILED', error: result.error },
      );
    })();
  }, [token]);

  const card = 'flex flex-col gap-5 rounded-card bg-white p-8 shadow-card ring-1 ring-line';

  if (state.step === 'CHECKING') {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Verifying your email</h1>
        <p role="status" className="text-[15px] text-ink-muted">
          One moment…
        </p>
      </div>
    );
  }

  if (state.step === 'VERIFIED') {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          {state.alreadyVerified ? 'Already verified' : 'Email verified'}
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          {state.alreadyVerified
            ? 'This address was already confirmed. You can sign in.'
            : 'Your account is active. Sign in to get started.'}
        </p>
        <div>
          <a href="/login" className="inline-flex">
            <Button size="lg">Sign in</Button>
          </a>
        </div>
      </div>
    );
  }

  // NO_TOKEN and FAILED share a remedy: get a new link.
  return <NeedsNewLink reason={state.step === 'NO_TOKEN' ? 'NO_TOKEN' : 'EXPIRED'} />;
}

/**
 * The dead-end that used to be one.
 *
 * A verification token lives 24 hours. Before resend existed, letting one lapse
 * meant the account could not sign in and nothing in the product could issue
 * another — registering again fails on the unique email. So the failure state
 * has to carry the way out of it, not just an apology.
 */
function NeedsNewLink({ reason }: { readonly reason: 'NO_TOKEN' | 'EXPIRED' }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  async function resend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api('/api/auth/verify-email/resend', {
      method: 'POST',
      body: { email: String(form.get('email') ?? '').trim() },
    });

    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error);
  }

  const card = 'flex flex-col gap-5 rounded-card bg-white p-8 shadow-card ring-1 ring-line';

  if (sent) {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Check your email</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          If that address still needs verifying, a new link is on its way. It is good for 24 hours.
        </p>
        <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className={card}>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
        {reason === 'NO_TOKEN' ? 'No verification link' : 'This link no longer works'}
      </h1>
      <p className="text-[15px] leading-relaxed text-ink-muted">
        {reason === 'NO_TOKEN'
          ? 'Open the link from your verification email, or ask for a new one below.'
          : 'Verification links expire after 24 hours, and each one can be used once. Ask for a new one below.'}
      </p>

      <form method="post" onSubmit={resend} className="flex flex-col gap-5" noValidate>
        <Field id="email" label="Your email">
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
            invalid={Boolean(error)}
          />
        </Field>

        <FormError message={error ? error.message : null} />

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Sending…' : 'Send a new link'}
        </Button>
      </form>

      <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
        Back to sign in
      </a>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
