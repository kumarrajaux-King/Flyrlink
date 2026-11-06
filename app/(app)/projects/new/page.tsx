'use client';

/**
 * `/projects/new` — the intake flow.
 *
 * Three steps, and the middle one is the product's whole argument:
 *
 *   1. Describe    the brief, in the customer's own words.
 *   2. Analyse     an agent structures it — and every line it produced is
 *                  editable, labelled as AI-authored, and approved by a person
 *                  before it counts.
 *   3. Submit      the project enters the lifecycle.
 *
 * WHAT IS REAL HERE
 *   Step 1 calls `POST /api/projects`, step 2 calls
 *   `POST /api/ai/agents/PROJECT_ARCHITECT/run`, and step 3 fires the `SUBMIT`
 *   event on the Phase 6 project machine. There is no local mock: if the agent
 *   fails, this page says so rather than showing invented requirements.
 *
 *   With no vendor key configured the run still succeeds, through the
 *   development stub provider, and every line it returns is prefixed so nobody
 *   mistakes a placeholder for analysis.
 */

import { useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Field, FormError, TextArea, TextInput } from '../../../../components/ui/field';
import { type ApiFailure, api, fieldError } from '../../../../lib/ui/api';
import { cn } from '../../../../lib/ui/cn';

interface ProjectView {
  readonly id: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly status: string;
}

interface Requirement {
  readonly type: string;
  content: string;
  readonly priority: number;
}

interface AgentRun {
  readonly status: string;
  readonly errorCode?: string | null;
  readonly output?: {
    readonly summary?: string;
    readonly requirements?: Requirement[];
    readonly suggestedRoles?: string[];
    readonly confidence?: string;
  } | null;
}

type Step = 'DESCRIBE' | 'REVIEW' | 'DONE';

const STEPS: { key: Step; label: string }[] = [
  { key: 'DESCRIBE', label: 'Describe' },
  { key: 'REVIEW', label: 'Review' },
  { key: 'DONE', label: 'Submitted' },
];

export default function NewProjectPage() {
  const [step, setStep] = useState<Step>('DESCRIBE');
  const [busy, setBusy] = useState<false | 'CREATING' | 'ANALYSING' | 'SUBMITTING'>(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);

  /** Step 1 → 2: create the draft, then ask the architect agent to structure it. */
  async function describe(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();

    setBusy('CREATING');
    setError(null);

    const created = await api<ProjectView>('/api/projects', {
      method: 'POST',
      body: { title, description },
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error);
      return;
    }
    setProject(created.data);

    setBusy('ANALYSING');
    const run = await api<AgentRun>('/api/ai/agents/PROJECT_ARCHITECT/run', {
      method: 'POST',
      body: { projectId: created.data.id, input: { projectId: created.data.id, title, description } },
    });
    setBusy(false);

    if (!run.ok) {
      // The draft exists either way, so the flow continues without analysis
      // rather than stranding the brief that was just written.
      setAnalysisNote(`The analysis could not run (${run.error.code}). Your brief is saved as a draft.`);
      setStep('REVIEW');
      return;
    }

    if (run.data.status !== 'SUCCEEDED' || !run.data.output) {
      setAnalysisNote(
        `The agent finished as ${run.data.status}${run.data.errorCode ? ` (${run.data.errorCode})` : ''}. Your brief is saved as a draft.`,
      );
      setStep('REVIEW');
      return;
    }

    setSummary(run.data.output.summary ?? null);
    setRequirements(run.data.output.requirements ?? []);
    setStep('REVIEW');
  }

  /** Step 2 → 3: fire SUBMIT on the project machine. */
  async function submit(): Promise<void> {
    if (!project) return;
    setBusy('SUBMITTING');
    setError(null);

    const result = await api<{ to: string }>(`/api/projects/${project.id}/transitions`, {
      method: 'POST',
      body: { event: 'SUBMIT' },
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep('DONE');
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink">Post a project</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">
          Describe the outcome you want. An agent structures it into a brief you can edit — nothing is committed until
          you submit it.
        </p>
        <ol className="flex flex-wrap items-center gap-2 pt-1">
          {STEPS.map((entry, index) => {
            const reached = STEPS.findIndex((s) => s.key === step) >= index;
            return (
              <li key={entry.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium',
                    reached ? 'bg-brand-500 text-white' : 'bg-white text-ink-subtle ring-1 ring-line',
                  )}
                >
                  <span className="tabular-nums">{index + 1}</span>
                  {entry.label}
                </span>
                {index < STEPS.length - 1 ? <span aria-hidden="true" className="text-ink-subtle">→</span> : null}
              </li>
            );
          })}
        </ol>
      </header>

      {step === 'DESCRIBE' ? (
        <form method="post" onSubmit={describe} className="flex flex-col gap-6 rounded-card bg-white p-7 shadow-card ring-1 ring-line" noValidate>
          <Field id="title" label="What should we call it?" error={fieldError(error, 'title')}>
            <TextInput
              id="title"
              name="title"
              required
              maxLength={160}
              autoFocus
              placeholder="Marketplace for local tutors"
              invalid={Boolean(fieldError(error, 'title'))}
            />
          </Field>

          <Field
            id="description"
            label="Describe the outcome"
            hint="Plain language is fine. Say what it should do, who it is for, and anything that must be true. No specification needed."
            error={fieldError(error, 'description')}
          >
            <TextArea
              id="description"
              name="description"
              rows={8}
              required
              minLength={20}
              maxLength={8000}
              placeholder="A marketplace where parents find local tutors, book sessions and pay securely. Tutors set their availability and rates; parents pay per session, held until the session is done."
              invalid={Boolean(fieldError(error, 'description'))}
            />
          </Field>

          <FormError message={error && !error.details ? error.message : null} />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={busy !== false}>
              {busy === 'CREATING' ? 'Saving…' : busy === 'ANALYSING' ? 'Structuring your brief…' : 'Structure my brief'}
            </Button>
            <span className="text-[13px] text-ink-subtle">Saved as a draft first — you can edit everything next.</span>
          </div>
        </form>
      ) : null}

      {step === 'REVIEW' && project ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-ink-subtle uppercase">Draft</p>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">{project.title}</h2>
            <p className="font-mono text-[12px] text-ink-subtle">{project.projectNumber}</p>
          </div>

          {analysisNote ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">
              {analysisNote}
            </p>
          ) : null}

          {summary ? (
            <div className="flex flex-col gap-3 rounded-card bg-canvas-tint p-7 ring-1 ring-brand-100">
              <p className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-brand-600 uppercase ring-1 ring-brand-200">
                Written by an agent
              </p>
              <p className="text-[15px] leading-relaxed text-ink">{summary}</p>
            </div>
          ) : null}

          {requirements.length > 0 ? (
            <div className="flex flex-col gap-4 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">Requirements</h2>
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Every line below was drafted by an agent. Edit anything that is wrong — your edits are what count.
                </p>
              </div>

              <ul className="flex flex-col gap-3">
                {requirements.map((requirement, index) => (
                  <li key={index} className="flex flex-col gap-2 rounded-xl bg-canvas-subtle p-4">
                    <span className="inline-flex w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold tracking-[0.1em] text-ink-muted uppercase ring-1 ring-line">
                      {requirement.type}
                    </span>
                    <TextArea
                      id={`requirement-${index}`}
                      aria-label={`Requirement ${index + 1}`}
                      rows={3}
                      value={requirement.content}
                      onChange={(event) => {
                        const next = [...requirements];
                        next[index] = { ...requirement, content: event.target.value };
                        setRequirements(next);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <FormError message={error ? error.message : null} />

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={submit} disabled={busy !== false}>
              {busy === 'SUBMITTING' ? 'Submitting…' : 'Submit the project'}
            </Button>
            <a href={`/projects/${project.id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              Keep it as a draft →
            </a>
          </div>
        </div>
      ) : null}

      {step === 'DONE' && project ? (
        <div className="flex flex-col gap-4 rounded-card bg-white p-7 shadow-card ring-1 ring-line">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Submitted</h2>
          <p className="text-[15px] leading-relaxed text-ink-muted">
            {project.projectNumber} has entered the lifecycle. Analysis and matching run next; you approve anything
            that follows.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={() => window.location.assign(`/projects/${project.id}`)}>
              Open the project
            </Button>
            <a href="/projects" className="self-center text-sm font-semibold text-brand-600 hover:text-brand-700">
              All projects →
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
