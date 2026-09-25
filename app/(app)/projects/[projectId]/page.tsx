'use client';

/**
 * `/projects/[id]` — one project.
 *
 * The page shows where the project stands, the brief it started from, and the
 * requirements as they are now — each one labelled with who wrote it, because
 * "an agent drafted this and a person approved it" is the claim the whole
 * product rests on.
 *
 * Actions are driven by the lifecycle, not by this page: it offers only the
 * events the customer can actually fire from the current state, and each one
 * posts to `/api/projects/:id/transitions`. The server decides; a refusal is
 * shown as the server worded it.
 */

import { use, useCallback, useEffect, useState } from 'react';

import { StatusPill } from '../../../../components/app/status-pill';
import { Button } from '../../../../components/ui/button';
import { type ApiFailure, api } from '../../../../lib/ui/api';

interface Requirement {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly source: string;
  readonly isApproved: boolean;
}

interface Project {
  readonly id: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly source: string;
  readonly engagementType: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly requirements: readonly Requirement[];
}

/**
 * The customer-fireable events, by state.
 *
 * Only what a customer holds a permission for and what the machine allows from
 * that state. Anything else is either the platform's or the expert's, and
 * offering it here would produce a refusal the person could not act on.
 */
const ACTIONS: Readonly<Record<string, { event: string; label: string }[]>> = {
  DRAFT: [{ event: 'SUBMIT', label: 'Submit the project' }],
  REQUIREMENT_REVIEW: [
    { event: 'APPROVE_REQUIREMENTS', label: 'Approve the requirements' },
    { event: 'REQUEST_REANALYSIS', label: 'Ask for another pass' },
  ],
  RECOMMENDED: [{ event: 'SHORTLIST', label: 'Shortlist an expert' }],
};

export default function ProjectPage({ params }: { readonly params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<Project>(`/api/projects/${projectId}`);
    if (result.ok) setProject(result.data);
    else setError(result.error);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function fire(event: string): Promise<void> {
    setBusy(event);
    setError(null);
    const result = await api(`/api/projects/${projectId}/transitions`, { method: 'POST', body: { event } });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
  }

  if (error && !project) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
          {error.status === 404 ? 'No such project' : 'You cannot open this project'}
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">{error.message}</p>
        <a href="/projects" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← All projects
        </a>
      </div>
    );
  }

  if (!project) {
    return <div aria-busy="true" className="mx-auto h-64 w-full max-w-4xl animate-pulse rounded-card bg-white ring-1 ring-line" />;
  }

  const actions = ACTIONS[project.status] ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
      <a href="/projects" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← All projects
      </a>

      <header className="flex flex-col gap-4 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-balance text-ink">{project.title}</h1>
            <p className="font-mono text-[12px] text-ink-subtle">{project.projectNumber}</p>
          </div>
          <StatusPill status={project.status} />
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          {[
            ['Entry', project.source.replace(/_/g, ' ').toLowerCase()],
            ['Engagement', project.engagementType.replace(/_/g, ' ').toLowerCase()],
            ['Currency', project.currency],
            ['Submitted', project.submittedAt ? new Date(project.submittedAt).toLocaleDateString('en-IN') : 'Not yet'],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-[11px] font-semibold tracking-[0.14em] text-ink-subtle uppercase">{label}</dt>
              <dd className="text-[14px] font-medium text-ink first-letter:uppercase">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[13px] leading-relaxed font-medium text-red-700 ring-1 ring-red-200 ring-inset">
          {error.message}
        </p>
      ) : null}

      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card bg-canvas-tint p-6 ring-1 ring-brand-100">
          <p className="mr-auto text-[14px] font-medium text-ink">What happens next is yours to decide.</p>
          {actions.map((action, index) => (
            <Button
              key={action.event}
              variant={index === 0 ? 'primary' : 'secondary'}
              onClick={() => fire(action.event)}
              disabled={busy !== null}
            >
              {busy === action.event ? 'Working…' : action.label}
            </Button>
          ))}
        </div>
      ) : null}

      <section className="flex flex-col gap-3 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">The brief</h2>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-muted">{project.description}</p>
      </section>

      <section className="flex flex-col gap-4 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">Requirements</h2>
          <span className="text-[13px] text-ink-subtle tabular-nums">{project.requirements.length}</span>
        </div>

        {project.requirements.length === 0 ? (
          <p className="text-[14px] leading-relaxed text-ink-muted">
            None yet. They are drafted when the project is analysed, and you edit and approve them.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {project.requirements.map((requirement) => (
              <li key={requirement.id} className="flex flex-col gap-2 rounded-xl bg-canvas-subtle p-4">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold tracking-[0.1em] text-ink-muted uppercase ring-1 ring-line">
                    {requirement.type}
                  </span>
                  {requirement.source === 'AI_AGENT' ? (
                    <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200">
                      Drafted by an agent
                    </span>
                  ) : (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-line">
                      Written by you
                    </span>
                  )}
                  {requirement.isApproved ? (
                    <span className="rounded-full bg-positive-soft px-2.5 py-1 text-[11px] font-semibold text-positive">
                      Approved
                    </span>
                  ) : null}
                </span>
                <p className="text-[14px] leading-relaxed text-ink">{requirement.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
