'use client';

/**
 * `/forgot-password` — ask for a reset link.
 *
 * The confirmation is the same whether or not the address is registered,
 * because the endpoint answers the same way. That is the enumeration rule the
 * whole auth surface follows: this form must not become the one place you can
 * ask "does this person have an account?" and get a straight answer.
 *
 * So the copy is written to be true in both cases — "if that address has an
 * account" — rather than a cheerful "sent!" that quietly lies half the time.
 */

import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../lib/ui/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api('/api/auth/password/forgot', {
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
          If that address has an account, a reset link is on its way. It is good for 30 minutes,
          and using it signs out every device.
        </p>
        <p className="text-[13px] leading-relaxed text-ink-subtle">
          Nothing arrived? Check spam, then try again in a minute — we hold off on a second mail
          for a moment to stop the address being used to flood an inbox.
        </p>
        <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Reset your password</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Enter the address you signed up with and we will email you a link.
        </p>
      </div>

      <form method="post" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Field id="email" label="Email" error={fieldError(error, 'email')}>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
            invalid={Boolean(fieldError(error, 'email'))}
          />
        </Field>

        <FormError message={error && !error.details ? error.message : null} />

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a link'}
        </Button>
      </form>

      <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
        Back to sign in
      </a>
    </div>
  );
}
