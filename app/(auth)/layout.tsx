/**
 * Layout for the authentication screens.
 *
 * A single centred column on a tinted ground, with the brand mark linking home.
 * Deliberately free of navigation: there is nothing useful to reach from here,
 * and a half-populated shell around a sign-in form only invites a click that
 * loses whatever was typed.
 */

import type { ReactNode } from 'react';

import { Logo } from '../../components/ui/logo';

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-canvas-tint">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute -right-32 -bottom-40 size-[28rem] rounded-full bg-accent-100/50 blur-3xl" />
      </div>

      <header className="px-5 py-6 sm:px-8">
        <a href="/" className="inline-flex rounded-lg">
          <Logo />
          <span className="sr-only">Flyrlink home</span>
        </a>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 pb-16 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
