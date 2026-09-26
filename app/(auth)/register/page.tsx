'use client';

/**
 * `/register` — create an account.
 *
 * The account type is a real fork, not a preference: it decides which profile
 * row is created and therefore which half of the marketplace the person can
 * act in. It is asked once, plainly, rather than inferred later.
 *
 * On success the API answers 202 with no user id — deliberately, so the
 * response cannot be used to discover whether an address is registered. The
 * page shows the same confirmation either way, which is why the copy says
 * "check your email" rather than "account created".
 */

import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Field, FormError, TextInput } from '../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../lib/ui/api';
import { cn } from '../../../lib/ui/cn';

type AccountType = 'CUSTOMER' | 'EXPERT';

const TYPES: { value: AccountType; label: string; blurb: string }[] = [
  { value: 'CUSTOMER', label: 'I need work done', blurb: 'Post a brief and hire a verified expert.' },
  { value: 'EXPERT', label: 'I do the work', blurb: 'Get matched to briefs that fit your skills.' },
];

export default function RegisterPage() {
  const [accountType, setAccountType] = useState<AccountType>('CUSTOMER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const result = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        fullName: String(form.get('fullName') ?? ''),
        accountType,
        acceptedTerms: true,
      },
    });

    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4 rounded-card bg-white p-8 shadow-card ring-1 ring-line">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Check your email</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          If that address can be registered, a verification link is on its way. Open it to activate the account, then
          sign in.
        </p>
        <p className="text-[13px] leading-relaxed text-ink-subtle">
          No provider is configured in development, so the link is written to the server log instead of being sent.
        </p>
        <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Go to sign in →
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-card bg-white p-8 shadow-card ring-1 ring-line">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Create your account</h1>
        <p className="text-[15px] text-ink-muted">
          Already have one?{' '}
          <a href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </a>
          .
        </p>
      </div>

      <form method="post" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-2 text-sm font-semibold text-ink">Which are you?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPES.map((type) => (
              <label
                key={type.value}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-xl p-4 ring-1 transition-[box-shadow,background-color] duration-200',
                  accountType === type.value
                    ? 'bg-brand-50 ring-2 ring-brand-400'
                    : 'bg-white ring-line hover:ring-brand-200',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="accountType"
                    value={type.value}
                    checked={accountType === type.value}
                    onChange={() => setAccountType(type.value)}
                    className="size-4 accent-brand-500"
                  />
                  <span className="text-sm font-semibold text-ink">{type.label}</span>
                </span>
                <span className="text-[13px] leading-relaxed text-ink-subtle">{type.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="fullName" label="Full name" error={fieldError(error, 'fullName')}>
          <TextInput
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            invalid={Boolean(fieldError(error, 'fullName'))}
            placeholder="Priya Nair"
          />
        </Field>

        <Field id="email" label="Email" error={fieldError(error, 'email')}>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            invalid={Boolean(fieldError(error, 'email'))}
            placeholder="you@company.com"
          />
        </Field>

        <Field
          id="password"
          label="Password"
          hint="At least 12 characters."
          error={fieldError(error, 'password')}
        >
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(fieldError(error, 'password'))}
          />
        </Field>

        {/* A field-level message has already been shown; this is for everything else. */}
        <FormError message={error && !error.details ? error.message : null} />

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>

        <p className="text-[12px] leading-relaxed text-ink-subtle">
          Creating an account accepts the Terms of Service, which are drafted but not yet in force pending review by
          Indian counsel.
        </p>
      </form>
    </div>
  );
}
