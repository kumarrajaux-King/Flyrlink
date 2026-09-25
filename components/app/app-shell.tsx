'use client';

/**
 * The signed-in shell: a persistent sidebar of primary destinations, a top bar
 * carrying the unread badges, and the account menu.
 *
 * The badges come from `/api/notifications/summary`, one request for both
 * counts — the header renders them together and polling them separately would
 * double the request rate for no benefit.
 *
 * Destinations that have no screen yet are shown, disabled, with the reason.
 * Hiding them would misrepresent the product's shape; linking them would send
 * someone to a 404.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '../../lib/ui/api';
import { cn } from '../../lib/ui/cn';
import { Logo } from '../ui/logo';

interface Destination {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ReactNode;
  readonly ready: boolean;
}

const icon = (path: string) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-[18px]"
  >
    <path d={path} />
  </svg>
);

const DESTINATIONS: Destination[] = [
  { label: 'Projects', href: '/projects', ready: true, icon: icon('M4 6h16M4 12h16M4 18h10') },
  { label: 'New brief', href: '/projects/new', ready: true, icon: icon('M12 5v14M5 12h14') },
  { label: 'Messages', href: '/messages', ready: false, icon: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z') },
  { label: 'Payments', href: '/payments', ready: false, icon: icon('M3 7h18v11H3zM3 11h18') },
  { label: 'Settings', href: '/settings', ready: false, icon: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 12h1m14 0h1M12 4v1m0 14v1') },
];

interface Summary {
  readonly unreadNotifications: number;
  readonly unreadMessages: number;
}

export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  // `usePathname` is identical on the server and the client; reading
  // `window.location` during render is a hydration mismatch.
  const path = usePathname();

  useEffect(() => {
    let cancelled = false;
    void api<Summary>('/api/notifications/summary').then((result) => {
      if (!cancelled && result.ok) setSummary(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  }

  const nav = (
    <nav aria-label="Workspace" className="flex flex-col gap-1">
      {DESTINATIONS.map((destination) => {
        const active = path === destination.href || (destination.href !== '/projects/new' && path.startsWith(`${destination.href}/`));
        if (!destination.ready) {
          return (
            <span
              key={destination.href}
              aria-disabled="true"
              title="This screen is not built yet."
              className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-subtle/70"
            >
              {destination.icon}
              {destination.label}
              <span className="ml-auto text-[10px] font-semibold tracking-[0.12em] uppercase">Soon</span>
            </span>
          );
        }
        return (
          <a
            key={destination.href}
            href={destination.href}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200',
              active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-canvas-subtle hover:text-ink',
            )}
          >
            {destination.icon}
            {destination.label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-canvas-subtle lg:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-line bg-white px-4 py-6 lg:flex">
        <a href="/" className="px-2">
          <Logo />
          <span className="sr-only">Flyrlink home</span>
        </a>
        {nav}
        <button
          type="button"
          onClick={signOut}
          className="mt-auto cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink"
        >
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-5 sm:px-8">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="workspace-nav"
              className="grid size-10 cursor-pointer place-items-center rounded-full ring-1 ring-line lg:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5">
                <path d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} />
              </svg>
              <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            </button>

            <span className="lg:hidden">
              <Logo />
            </span>

            <div className="ml-auto flex items-center gap-2">
              <Badge label="Messages" count={summary?.unreadMessages ?? 0} />
              <Badge label="Notifications" count={summary?.unreadNotifications ?? 0} />
            </div>
          </div>

          {open ? (
            <div id="workspace-nav" className="border-t border-line px-3 pb-4 lg:hidden">
              {nav}
              <button
                type="button"
                onClick={signOut}
                className="mt-1 w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-5 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}

function Badge({ label, count }: { readonly label: string; readonly count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-canvas-subtle px-2.5 py-1.5 text-[13px] font-medium text-ink-muted sm:px-3"
      title={`${count} unread ${label.toLowerCase()}`}
      aria-label={`${count} unread ${label.toLowerCase()}`}
    >
      <span className="hidden sm:inline">{label}</span>
      <span aria-hidden="true" className="sm:hidden">
        {label === 'Messages' ? '✉' : '🔔'}
      </span>
      <span
        className={cn(
          'min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
          count > 0 ? 'bg-brand-500 text-white' : 'bg-white text-ink-subtle ring-1 ring-line',
        )}
      >
        {count}
      </span>
    </span>
  );
}
