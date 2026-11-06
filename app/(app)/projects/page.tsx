'use client';

/**
 * `/projects` — the client's briefs.
 *
 * Status is the column that matters, so it is rendered as a pill rather than
 * text: the whole product is a state machine, and which state a project sits in
 * decides what the customer can do next.
 *
 * The empty state is the copy from the content spec (§7.4): it says what to do
 * rather than announcing that a list is empty.
 */

import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { type ApiFailure, api } from '../../../lib/ui/api';
import { STATUS_TONE, StatusPill } from '../../../components/app/status-pill';

interface ProjectRow {
  readonly id: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly requirements: readonly unknown[];
}

export default function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ items: ProjectRow[] }>('/api/projects').then((result) => {
      if (cancelled) return;
      if (result.ok) setRows(result.data.items);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink">Projects</h1>
          <p className="text-[15px] text-ink-muted">Every brief you have posted, and where each one stands.</p>
        </div>
        <Button size="lg" onClick={() => window.location.assign('/projects/new')}>
          Post a project
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700 ring-1 ring-red-200 ring-inset">
          {error.message}
        </p>
      ) : null}

      {rows === null && !error ? (
        <ul className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className="h-24 animate-pulse rounded-card bg-white ring-1 ring-line" />
          ))}
        </ul>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <div className="flex flex-col items-start gap-4 rounded-card bg-white p-10 shadow-card ring-1 ring-line">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Nothing here yet</h2>
          <p className="max-w-md text-[15px] leading-relaxed text-ink-muted">
            Describe what you need and we will structure it into a brief.
          </p>
          <Button size="lg" onClick={() => window.location.assign('/projects/new')}>
            Post a project
          </Button>
        </div>
      ) : null}

      {rows && rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={`/projects/${row.id}`}
                className="flex flex-col gap-3 rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow,outline-color] duration-300 ease-soft hover:-translate-y-0.5 hover:shadow-card-hover hover:ring-brand-200 sm:flex-row sm:items-center"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{row.title}</span>
                  <span className="font-mono text-[12px] text-ink-subtle">{row.projectNumber}</span>
                </span>
                <span className="flex items-center gap-4 sm:ml-auto">
                  <span className="text-[13px] text-ink-subtle tabular-nums">
                    {new Date(row.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <StatusPill status={row.status} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {rows && rows.length > 0 ? (
        <p className="text-[12px] text-ink-subtle">
          Statuses come from the project state machine; {Object.keys(STATUS_TONE).length} of them are possible.
        </p>
      ) : null}
    </div>
  );
}
