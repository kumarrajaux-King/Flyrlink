/**
 * `/dashboard` — the landing surface, and the router between roles.
 *
 * Every signed-in person is sent here after authenticating, and this page
 * decides where they actually belong: a CUSTOMER stays and sees the client
 * dashboard; anyone else is redirected to the surface their role owns.
 *
 * Doing it here rather than in `/login` means the decision survives a
 * bookmark, a refresh, and a role change — the answer is recomputed from the
 * database on every request rather than baked into a redirect the browser
 * remembers.
 *
 * `?denied=1` arrives when a page-level gate turned someone away. It is shown
 * plainly instead of silently dropping them on a dashboard with no explanation.
 */

import { redirect } from 'next/navigation';

import { DashboardScaffold } from '../../../components/app/dashboard-scaffold';
import { SignOutButton } from '../../../components/app/sign-out-button';
import { primaryDashboard } from '../../../lib/authz/dashboards';
import { prisma } from '../../../lib/db/client';
import { requireUser } from '../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser('/dashboard');
  const { denied } = await searchParams;

  // `denied` means a page gate turned this viewer away. Forwarding them again
  // would send them straight back to the page that refused them, and that page
  // would return them here — an infinite redirect rather than an explanation.
  // So a denial always stops at this screen, whatever role the viewer holds.
  const destination = denied ? null : primaryDashboard(user.roles);
  if (destination && destination.path !== '/dashboard') redirect(destination.path);

  // Real counts for the client dashboard, scoped to this customer by the same
  // profile link the projects API uses.
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: user.userId },
    select: { id: true },
  });
  const [total, drafts, active] = profile
    ? await Promise.all([
        prisma.project.count({ where: { customerId: profile.id, deletedAt: null } }),
        prisma.project.count({ where: { customerId: profile.id, deletedAt: null, status: 'DRAFT' } }),
        prisma.project.count({ where: { customerId: profile.id, deletedAt: null, status: 'ACTIVE' } }),
      ])
    : [0, 0, 0];

  return (
    <DashboardScaffold
      title={`Welcome, ${user.fullName.split(' ')[0]}`}
      role={user.roles[0] ?? 'CUSTOMER'}
      purpose="Your projects, approvals due, and what is waiting on you."
      permissions={['project:create:own', 'project:read:own']}
      pending={[
        'Approvals due — the milestone review queue (Phase 6 backend is live)',
        'Spend to date and escrow held (Phase 10)',
        'Recent activity across your engagements (Phase 9 backend is live)',
      ]}
    >
      {/*
        Identity, stated on the page rather than only in the shell. While the
        product is being assembled this is the evidence that the session
        resolved: the name, address and roles below were read from the database
        on this request, not held in the browser.
      */}
      <section className="flex flex-wrap items-center gap-5 rounded-card bg-white p-6 shadow-card ring-1 ring-line">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-100 text-[15px] font-semibold text-brand-700">
          {user.fullName
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase()}
        </span>

        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{user.fullName}</p>
          <p className="truncate text-[14px] text-ink-muted">{user.email}</p>
          <p className="flex flex-wrap items-center gap-1.5 pt-1">
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
              <span className="rounded-full bg-positive-soft px-2.5 py-1 text-[11px] font-semibold text-positive">
                MFA on
              </span>
            ) : null}
          </p>
        </div>

        <SignOutButton className="ml-auto bg-navy-800 text-white hover:bg-navy-900" />
      </section>

      {denied ? (
        <p
          role="alert"
          className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] leading-relaxed font-medium text-amber-800 ring-1 ring-amber-200 ring-inset"
        >
          Your account does not have access to that area. If that looks wrong, contact your administrator.
        </p>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Projects', value: total, href: '/projects' },
          { label: 'Drafts', value: drafts, href: '/projects' },
          { label: 'Active', value: active, href: '/projects' },
        ].map((tile) => (
          <a
            key={tile.label}
            href={tile.href}
            className="flex flex-col gap-1 rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow] duration-300 ease-soft hover:-translate-y-0.5 hover:shadow-card-hover"
          >
            <span className="text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">{tile.label}</span>
            <span className="text-3xl font-semibold tracking-[-0.02em] text-ink tabular-nums">{tile.value}</span>
          </a>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-card bg-white p-6 shadow-card ring-1 ring-line">
        <p className="mr-auto text-[15px] text-ink">Describe an outcome and we will structure it into a brief.</p>
        <a
          href="/projects/new"
          className="inline-flex h-11 items-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-brand-600"
        >
          Post a project
        </a>
      </section>
    </DashboardScaffold>
  );
}
