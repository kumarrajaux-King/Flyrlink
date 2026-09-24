'use client';

/**
 * AI project discovery — the premium composer.
 *
 * Takes the place of the Figma "500+ verified pros, one tap away" blue band:
 * the same luminous brand band and glass treatment, now hosting the product's
 * core interaction. It shows the shape of what the agents return — structured
 * requirements, an advisory estimate, a team shape, a match count.
 *
 * The analysis is the local, deterministic preview in
 * `lib/marketing/preview-analysis.ts`, not the live agents. It is labelled as
 * such, and nothing typed leaves the browser.
 */

import { ArrowRight, Check, LoaderCircle, LockKeyhole, UsersRound, WandSparkles } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';

import { type PreviewAnalysis, analyseBrief } from '../../../lib/marketing/preview-analysis';
import { cn } from '../../../lib/ui/cn';
import { Badge } from '../../ui/badge';
import { Button, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Icon, type IconKey } from '../../ui/icon';
import { formatMinorCompact } from '../../ui/money';
import { Accent, Eyebrow } from '../../ui/section-heading';
import { PreviewActionButton } from '../preview-action';
import { BRIEF_EVENT, PREVIEW_MESSAGES } from '../preview-events';
import { SAMPLE_BRIEFS } from './content';

const AGENT_STEPS = [
  { agent: 'Project Architect', task: 'Understanding the outcome' },
  { agent: 'Requirements Analyst', task: 'Structuring scope and open questions' },
  { agent: 'Estimation', task: 'Estimating effort, timeline and budget' },
  { agent: 'Matching', task: 'Ranking verified experts' },
] as const;

const STEP_MS = 620;

const REQUIREMENT_LABEL = {
  OBJECTIVE: 'Objective',
  SCOPE: 'Scope',
  DELIVERABLE: 'Deliverable',
  CLARIFICATION_QUESTION: 'Question',
} as const;

const COMPLEXITY_LABEL = {
  LOW: 'Low complexity',
  MEDIUM: 'Medium complexity',
  HIGH: 'High complexity',
  VERY_HIGH: 'Very high complexity',
} as const;

const OUTPUTS: readonly { readonly icon: IconKey; readonly title: string; readonly body: string }[] = [
  { icon: 'listChecks', title: 'Structured requirements', body: 'Objective, scope, deliverables and open questions.' },
  { icon: 'calculator', title: 'Advisory estimate', body: 'Timeline and budget ranges with assumptions.' },
  { icon: 'users', title: 'Suggested team', body: 'The roles your outcome actually needs.' },
  { icon: 'target', title: 'Matched experts', body: 'Verified experts ranked with reasons.' },
];

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'too-short' }
  | { readonly kind: 'analyzing'; readonly step: number }
  | { readonly kind: 'done'; readonly analysis: PreviewAnalysis };

type StepStatus = 'pending' | 'active' | 'done';

function stepStatus(phase: Phase, index: number): StepStatus {
  if (phase.kind === 'done') return 'done';
  if (phase.kind !== 'analyzing') return 'pending';
  if (index < phase.step) return 'done';
  return index === phase.step ? 'active' : 'pending';
}

export function ProjectDiscovery() {
  const [brief, setBrief] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const hintId = useId();

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const run = useCallback(
    (text: string) => {
      clearTimers();
      const analysis = analyseBrief(text);
      if (!analysis) {
        setPhase({ kind: 'too-short' });
        textareaRef.current?.focus();
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setPhase({ kind: 'done', analysis });
        return;
      }
      setPhase({ kind: 'analyzing', step: 0 });
      AGENT_STEPS.forEach((_, index) => {
        timers.current.push(setTimeout(() => setPhase({ kind: 'analyzing', step: index + 1 }), STEP_MS * (index + 1)));
      });
      timers.current.push(setTimeout(() => setPhase({ kind: 'done', analysis }), STEP_MS * (AGENT_STEPS.length + 1)));
    },
    [clearTimers],
  );

  useEffect(() => {
    const onBrief = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setBrief(detail);
      run(detail);
    };
    window.addEventListener(BRIEF_EVENT, onBrief);
    return () => {
      window.removeEventListener(BRIEF_EVENT, onBrief);
      clearTimers();
    };
  }, [run, clearTimers]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(brief);
  };

  const analyzing = phase.kind === 'analyzing';

  return (
    <section id="describe" aria-labelledby="describe-title" className="relative isolate overflow-hidden bg-silk py-20 text-white sm:py-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(rgb(255_255_255/0.2)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />

      <Container className="grid grid-cols-1 gap-12 lg:grid-cols-[0.86fr_1.14fr] lg:gap-16">
        <div className="flex flex-col gap-6">
          <Eyebrow tone="dark">AI project discovery</Eyebrow>
          <h2 id="describe-title" className="text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Tell us what you want to build. <Accent className="text-white">We’ll do the groundwork.</Accent>
          </h2>
          <p className="max-w-lg text-lg leading-relaxed text-white/75">
            One sentence is enough. Four agents turn it into a brief you can act on — then show you who can deliver it.
          </p>

          <ol className="mt-1 flex flex-col gap-2.5">
            {AGENT_STEPS.map((item, index) => {
              const status = stepStatus(phase, index);
              return (
                <li
                  key={item.agent}
                  className={cn(
                    'surface-glass flex items-center gap-3.5 rounded-2xl px-4 py-3 transition-[background-color,opacity] duration-500',
                    status === 'active' && 'bg-white/22',
                    phase.kind === 'analyzing' && status === 'pending' && 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors duration-500',
                      status === 'done' ? 'bg-white text-brand-600' : 'bg-white/15 text-white',
                    )}
                  >
                    {status === 'done' ? (
                      <Check aria-hidden="true" className="size-4" strokeWidth={3} />
                    ) : status === 'active' ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">{item.agent}</span>
                    <span className="truncate text-[13px] text-white/65">{item.task}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-white/65">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Preview: this analysis runs in your browser on illustrative logic, not the live agents. Nothing you type is
            sent or stored.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <form onSubmit={onSubmit} className="rounded-panel bg-white p-2 text-ink shadow-elevated">
            <label htmlFor={textareaId} className="sr-only">
              Describe your project
            </label>
            <textarea
              ref={textareaRef}
              id={textareaId}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  run(brief);
                }
              }}
              rows={4}
              maxLength={600}
              placeholder="Tell us what you want to build…"
              aria-describedby={hintId}
              className="block w-full resize-none rounded-[1.35rem] bg-canvas-subtle px-5 py-4 text-lg leading-relaxed text-ink transition-[background-color,box-shadow] duration-300 placeholder:text-ink-subtle focus:bg-white focus:ring-2 focus:ring-brand-200 focus:outline-none"
            />
            <div className="flex flex-col gap-3 px-3 pt-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
              <p id={hintId} className="text-[13px] text-ink-subtle">
                Plain language is perfect.<span className="hidden sm:inline"> Ctrl + Enter to analyze.</span>
              </p>
              <Button type="submit" size="lg" disabled={analyzing}>
                {analyzing ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <WandSparkles aria-hidden="true" className="size-4" />
                )}
                {analyzing ? 'Analyzing…' : 'Analyze with AI'}
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap gap-2">
            <span className="self-center text-[13px] text-white/65">Try:</span>
            {SAMPLE_BRIEFS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setBrief(sample);
                  run(sample);
                }}
                className="surface-glass cursor-pointer rounded-2xl px-3.5 py-2 text-left text-[13px] leading-snug text-white/90 transition-colors duration-200 hover:bg-white/20 sm:rounded-full sm:py-1.5"
              >
                {sample}
              </button>
            ))}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {phase.kind === 'analyzing' ? 'Analyzing your brief.' : null}
            {phase.kind === 'done'
              ? `Analysis ready: ${phase.analysis.projectType}, ${phase.analysis.durationWeeks[0]} to ${phase.analysis.durationWeeks[1]} weeks.`
              : null}
            {phase.kind === 'too-short' ? 'Please add a little more detail to your brief.' : null}
          </p>

          {phase.kind === 'done' ? <AnalysisResult analysis={phase.analysis} /> : null}
          {phase.kind === 'analyzing' ? <AnalysisSkeleton /> : null}
          {phase.kind === 'too-short' ? (
            <p className="surface-glass rounded-2xl px-5 py-4 text-sm">
              Add a little more detail — a sentence about the outcome you want is enough.
            </p>
          ) : null}
          {phase.kind === 'idle' ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {OUTPUTS.map((output) => (
                <li key={output.title} className="surface-glass flex items-start gap-3 rounded-2xl p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                    <Icon name={output.icon} className="size-4" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{output.title}</span>
                    <span className="text-[13px] leading-snug text-white/65">{output.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

function AnalysisSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-panel bg-white/95 p-6 shadow-elevated">
      <div className="flex gap-2">
        <div className="h-7 w-28 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--color-brand-50),var(--color-brand-100),var(--color-brand-50))] bg-[length:200%_100%]" />
        <div className="h-7 w-32 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--color-canvas-subtle),var(--color-line),var(--color-canvas-subtle))] bg-[length:200%_100%]" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          {[92, 78, 84, 64].map((width) => (
            <div
              key={width}
              style={{ width: `${width}%` }}
              className="h-4 animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-canvas-subtle),var(--color-line),var(--color-canvas-subtle))] bg-[length:200%_100%]"
            />
          ))}
        </div>
        <div className="h-28 animate-shimmer rounded-2xl bg-[linear-gradient(90deg,var(--color-canvas-tint),var(--color-brand-100),var(--color-canvas-tint))] bg-[length:200%_100%]" />
      </div>
    </div>
  );
}

function CapsLabel({ children }: { readonly children: string }) {
  return <h3 className="text-[11px] font-semibold tracking-[0.18em] text-ink-subtle uppercase">{children}</h3>;
}

function AnalysisResult({ analysis }: { readonly analysis: PreviewAnalysis }) {
  const [minWeeks, maxWeeks] = analysis.durationWeeks;
  const [minBudget, maxBudget] = analysis.budgetMinor;

  return (
    <div className="animate-rise overflow-hidden rounded-panel bg-white text-ink shadow-elevated">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-4">
        <Badge tone="brand" size="md">
          {analysis.projectType}
        </Badge>
        <Badge tone="neutral" size="md">
          {COMPLEXITY_LABEL[analysis.complexity]}
        </Badge>
        <Badge tone="sample" size="md" className="sm:ml-auto">
          Illustrative preview
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-7 p-6 md:grid-cols-[1.15fr_1fr]">
        <div>
          <CapsLabel>Structured requirements</CapsLabel>
          <ul className="mt-3 flex flex-col gap-2.5">
            {analysis.requirements.map((requirement) => (
              <li key={`${requirement.type}-${requirement.text}`} className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-px inline-flex h-5 w-[5.25rem] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tracking-wide uppercase',
                    requirement.type === 'CLARIFICATION_QUESTION'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-brand-50 text-brand-700',
                  )}
                >
                  {REQUIREMENT_LABEL[requirement.type]}
                </span>
                <span className="text-sm leading-snug text-ink">{requirement.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-2xl bg-canvas-tint p-4 ring-1 ring-brand-100">
            <CapsLabel>Advisory estimate</CapsLabel>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[12px] text-ink-subtle">Timeline</dt>
                <dd className="text-lg font-semibold tracking-[-0.01em] tabular-nums">
                  {minWeeks}–{maxWeeks} weeks
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-subtle">Budget</dt>
                <dd className="text-lg font-semibold tracking-[-0.01em] tabular-nums">
                  {formatMinorCompact(minBudget, 'INR')}–{formatMinorCompact(maxBudget, 'INR')}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] text-ink-subtle">A range with assumptions — never a quote.</p>
          </div>

          <div>
            <CapsLabel>Suggested team</CapsLabel>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {analysis.team.map((role) => (
                <li key={role.role} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] text-ink ring-1 ring-line">
                  <UsersRound aria-hidden="true" className="size-3.5 text-brand-500" />
                  {role.count} × {role.role}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <CapsLabel>Key skills</CapsLabel>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {analysis.skills.map((skill) => (
                <li key={skill} className="rounded-full bg-canvas-subtle px-2.5 py-1 text-[12px] text-ink-muted ring-1 ring-line">
                  {skill}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-line bg-canvas-subtle px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2.5 text-sm text-ink-muted">
          <span aria-hidden="true" className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>
          <span>
            <strong className="font-semibold text-ink">{analysis.matchedExperts} verified experts</strong> fit this
            brief <span className="text-ink-subtle">(illustrative)</span>
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="#experts" variant="dark" size="sm">
            See matches
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </ButtonLink>
          <PreviewActionButton variant="secondary" size="sm" message={PREVIEW_MESSAGES.postProject}>
            Post this project
          </PreviewActionButton>
        </div>
      </div>
    </div>
  );
}
