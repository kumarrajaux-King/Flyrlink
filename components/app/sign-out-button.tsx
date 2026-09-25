'use client';

/**
 * Sign out.
 *
 * Posts to `/api/auth/logout`, which revokes the session row and clears the
 * cookie, then navigates with `window.location` rather than the router: the
 * session is gone, so every cached server component rendered for that account
 * has to be discarded too. A client-side push would keep them.
 *
 * Landing on `/login` rather than `/` is deliberate — someone who just signed
 * out most often wants to sign back in, or in as somebody else.
 */

import { useState } from 'react';

import { api } from '../../lib/ui/api';
import { cn } from '../../lib/ui/cn';

export function SignOutButton({
  className,
  children = 'Sign out',
}: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={cn(
        'cursor-pointer rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200 disabled:opacity-60',
        className ?? 'bg-white text-ink ring-1 ring-line-strong ring-inset hover:text-brand-600 hover:ring-brand-300',
      )}
    >
      {busy ? 'Signing out…' : children}
    </button>
  );
}
