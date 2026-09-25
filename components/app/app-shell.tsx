'use client';

/**
 * The signed-in shell: sidebar, header, who you are, what role you hold, and
 * the way out.
 *
 * Identity arrives as a prop from the server layout, which read it from the
 * database. The shell never fetches "who am I" itself, so there is no moment
 * where the page is rendered for nobody in particular, and no client-held
 * claim about a role.
 *
 * NAVIGATION IS NOT A PERMISSION
 *   The sidebar lists what this account can reach, which makes the product
 *   legible — but hiding a link has never been the control. Every page
 *   re-checks server-side, and a link typed by hand lands on the same gate.
 *
 * Destinations with no screen yet are shown disabled rather than hidden or
 * linked: hiding misrepresents the product's shape, and linking sends someone
 * to a 404.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '../../lib/ui/api';
import { cn } from '../../lib/ui/cn';
import { Logo } from '../ui/logo';

export interface ShellUser {
  readonly fullName: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly mfaEnabled: boolean;
}

export interface ShellDashboard {
  readonly path: string;
  readonly label: string;
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
    className="size-[18px] shrink-0"
  >
    <path d={path} />
  </svg>
);

const ICONS = {
  grid: icon('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
  list: icon('M4 6h16M4 12h16M4 18h10'),
  plus: icon('M12 5v14M5 12h14'),
  chat: icon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z'),
  card: icon('M3 7h18v11H3zM3 11h18'),
  cog: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 12h1m14 0h1M12 4v1m0 14v1'),
};

/** Work surfaces that exist, and the ones that do not yet. */
const WORK: { label: string; href: string; icon: React.ReactNode; ready: boolean }[] = [
  { label: 'Projects', href: '/projects', icon: ICONS.list, ready: true },
  { label: 'New brief', href: '/projects/new', icon: ICONS.plus, ready: true },
  { label: 'Messages', href: '/messages', icon: ICONS.chat, ready: false },
  { label: 'Payments', href: '/payments', icon: ICONS.card, ready: false },
  { label: 'Settings', href: '/settings', icon: ICONS.cog, ready: false },
];

interface Summary {
  readonly unreadNotifications: number;
  readonly unreadMessages: number;
}

export function AppShell({
  user,
  dashboards,
  children,
}: {
  readonly user: ShellUser;
  readonly dashboards: readonly ShellDashboard[];
  readonly children: React.ReactNode;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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
    setSigningOut(true);
    await api('/api/auth/logout', { method: 'POST' });
    // A full navigation, not a router push: the session is gone, so every
    // cached server component for this account must be discarded too.
    window.location.assign('/login');
  }

  const link = (href: string, label: string, glyph: React.ReactNode, active: boolean) => (
    <a
      key={href}
      href={href}
      onClick={() => setOpen(false)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200',
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-canvas-subtle hover:text-ink',
      )}
    >
      {glyph}
      {label}
    </a>
  );

  const nav = (
    <div className="flex flex-col gap-6">
      <nav aria-label="Dashboards" className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">Dashboards</p>
        {dashboards.map((dashboard) =>
          link(dashboard.path, dashboard.label, ICONS.grid, path === dashboard.path),
        )}
      </nav>

      <nav aria-label="Work" className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">Work</p>
        {WORK.map((entry) =>
          entry.ready ? (
            link(
              entry.href,
              entry.label,
              entry.icon,
              path === entry.href || (entry.href !== '/projects/new' && path.startsWith(`${entry.href}/`)),
            )
          ) : (
            <span
              key={entry.href}
              aria-disabled="true"
              title="This screen is not built yet."
              className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-subtle/70"
            >
              {entry.icon}
              {entry.label}
              <span className="ml-auto text-[10px] font-semibold tracking-[0.12em] uppercase">Soon</span>
            </span>
          ),
        )}
      </nav>
    </div>
  );

  const identity = (
    <div className="flex flex-col gap-3 border-t border-line px-3 pt-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700">
          {initials(user.fullName)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-ink">{user.fullName}</span>
          <span className="truncate text-[12px] text-ink-subtle">{user.email}</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {user.roles.length === 0 ? (
          <span className="rounded-full bg-canvas-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-subtle">
            No role
          </span>
        ) : (
          user.roles.map((role) => (
            <span
              key={role}
              className="rounded-full bg-canvas-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-muted"
            >
              {role.replace(/_/g, ' ').toLowerCase()}
            </span>
          ))
        )}
        {user.mfaEnabled ? (
          <span className="rounded-full bg-positive-soft px-2.5 py-1 text-[11px] font-semibold text-positive">MFA on</span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-canvas-subtle lg:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col gap-8 border-r border-line bg-white px-4 py-6 lg:flex">
        <a href="/" className="px-2">
          <Logo />
          <span className="sr-only">Flyrlink home</span>
        </a>
        {nav}
        <div className="mt-auto">{identity}</div>
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
              <span
                className="hidden size-9 place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700 sm:grid"
                title={`${user.fullName} · ${user.email}`}
              >
                {initials(user.fullName)}
              </span>
            </div>
          </div>

          {open ? (
            <div id="workspace-nav" className="flex flex-col gap-4 border-t border-line px-3 pt-3 pb-4 lg:hidden">
              {nav}
              {identity}
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-5 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
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
