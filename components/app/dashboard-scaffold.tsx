/**
 * The shared frame for a role's dashboard.
 *
 * Several of these surfaces have no feature work behind them yet. Rather than
 * mock numbers — which would be indistinguishable from a working screen at a
 * glance, and would be quoted back as fact — each one states plainly what it is
 * for, what it will show, and which permission let the viewer in.
 *
 * That last part is the useful bit while the product is being built: the screen
 * is evidence that the server let this role through, and names the grant it
 * checked.
 */

import type { ReactNode } from 'react';

export function DashboardScaffold({
  title,
  role,
  purpose,
  permissions,
  children,
  pending,
}: {
  readonly title: string;
  readonly role: string;
  readonly purpose: string;
  readonly permissions: readonly string[];
  readonly children?: ReactNode;
  /** What this screen will hold once its phase is built. */
  readonly pending?: readonly string[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-brand-600 uppercase ring-1 ring-line">
          {role.replace(/_/g, ' ').toLowerCase()}
        </span>
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink">{title}</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-muted">{purpose}</p>
      </header>

      {children}

      {pending && pending.length > 0 ? (
        <section className="flex flex-col gap-4 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">Not built yet</h2>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            The backend for this area is implemented and tested; the screens are not. These are what belong here:
          </p>
          <ul className="flex flex-col gap-2">
            {pending.map((entry) => (
              <li key={entry} className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-muted">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
                {entry}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-card bg-canvas-tint p-6 ring-1 ring-brand-100">
        <h2 className="text-[13px] font-semibold tracking-[0.1em] text-brand-700 uppercase">Why you can see this</h2>
        <p className="text-[14px] leading-relaxed text-ink-muted">
          The server resolved your session, read your roles from the database, and checked that you hold at least one
          of the grants below before rendering anything. Hiding a link is never what stops anyone — this check runs
          again on every request, including a direct URL.
        </p>
        <ul className="flex flex-wrap gap-2">
          {permissions.map((permission) => (
            <li key={permission}>
              <code className="rounded-md bg-white px-2.5 py-1 font-mono text-[12px] text-ink-muted ring-1 ring-line">
                {permission}
              </code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
