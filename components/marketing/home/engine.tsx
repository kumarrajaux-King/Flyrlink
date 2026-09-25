'use client';

/**
 * The Flyrlink Engine — landing copy §3.
 *
 * "Thirteen agents. A human decision at every gate." The claim is substantiated
 * (§9 #6: thirteen agents are registered), and the section is built so it can be
 * *checked* rather than taken on faith: each step shows what the client sees
 * beside what runs underneath, naming the agents and the records involved.
 *
 * WHY IT IS INTERACTIVE
 *   Five steps shown as five static cards read as a marketing rail. Opening one
 *   at a time, and exposing the machinery behind it, turns the same content into
 *   something a sceptical buyer can interrogate — which is exactly the posture
 *   §10 asks for: say what the system does and who decides.
 *
 * Keyboard: the step list is a tab list with arrow-key roving focus, so the
 * whole section works without a pointer.
 */

import { ArrowRight, Check } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '../../../lib/ui/cn';
import { ButtonArrow, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { ENGINE_STEPS } from './content';
import { Term } from './glossary';

export function Engine() {
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = ENGINE_STEPS[index]!;

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, position: number): void {
    const last = ENGINE_STEPS.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? position === last
          ? 0
          : position + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? position === 0
            ? last
            : position - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setIndex(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="how-it-works" aria-labelledby="engine-title" className="scroll-mt-20 bg-canvas-subtle py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <SectionHeading
            id="engine-title"
            eyebrow="AI-agentic matching"
            title={
              <>
                Thirteen agents. <Accent>A human decision at every gate.</Accent>
              </>
            }
          />
          <div className="flex flex-col items-start gap-6 lg:items-end lg:text-right">
            <p className="max-w-md text-lg leading-relaxed text-ink-muted">
              Flyrlink does the groundwork — structuring the brief, estimating effort, ranking candidates and
              explaining why — then stops and asks you. Agents never hire, never move money and never approve work.
            </p>
            <ButtonLink href="#describe" variant="dark" size="lg" className="pr-4">
              Start with your brief
              <ButtonArrow />
            </ButtonLink>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-10">
          <div role="tablist" aria-label="The five steps" aria-orientation="vertical" className="flex flex-col gap-2">
            {ENGINE_STEPS.map((step, position) => {
              const selected = position === index;
              return (
                <button
                  key={step.number}
                  ref={(node) => {
                    tabs.current[position] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`engine-tab-${step.number}`}
                  aria-selected={selected}
                  aria-controls={`engine-panel-${step.number}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setIndex(position)}
                  onKeyDown={(event) => onKeyDown(event, position)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-4 rounded-card px-4 py-4 text-left ring-1 transition-[background-color,box-shadow,translate] duration-300 ease-soft',
                    selected
                      ? 'bg-white shadow-card-hover ring-brand-200'
                      : 'bg-white/50 ring-line hover:-translate-y-0.5 hover:bg-white hover:shadow-card',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums transition-colors duration-300',
                      selected ? 'bg-brand-500 text-white' : 'bg-canvas-subtle text-ink-subtle group-hover:text-brand-600',
                    )}
                  >
                    {step.number}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('text-[15px] font-semibold tracking-[-0.01em]', selected ? 'text-ink' : 'text-ink-muted')}>
                      {step.title}
                    </span>
                    <span className="truncate text-[13px] text-ink-subtle">{step.seen}</span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className={cn(
                      'ml-auto size-4 shrink-0 transition-[opacity,translate] duration-300',
                      selected ? 'translate-x-0 text-brand-500 opacity-100' : '-translate-x-1 opacity-0',
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`engine-panel-${active.number}`}
            aria-labelledby={`engine-tab-${active.number}`}
            className="flex flex-col gap-6 rounded-card bg-white p-7 shadow-card ring-1 ring-line sm:p-9"
          >
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600">
                <Icon name={active.icon} className="size-6" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-semibold tracking-[0.22em] text-brand-600 uppercase">
                  Step {active.number}
                </p>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{active.title}</h3>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-2xl bg-canvas-subtle p-5">
                <dt className="text-[11px] font-semibold tracking-[0.18em] text-ink-subtle uppercase">
                  What you see
                </dt>
                <dd className="text-[15px] leading-relaxed text-ink">{active.seen}</dd>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl bg-navy-900 p-5 text-white">
                <dt className="text-[11px] font-semibold tracking-[0.18em] text-accent-300 uppercase">
                  What runs underneath
                </dt>
                <dd className="text-[15px] leading-relaxed text-white/85">{active.underneath}</dd>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {active.machinery.map((name) => (
                    <code
                      key={name}
                      className="rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] tracking-tight text-accent-100"
                    >
                      {name}
                    </code>
                  ))}
                </dd>
              </div>
            </dl>

            <div className="flex flex-col gap-3 border-t border-line pt-5">
              <p className="inline-flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" strokeWidth={2.5} />
                <span>
                  <strong className="font-semibold text-ink">Explainability.</strong> Every recommendation shows its
                  breakdown — skill match, experience, availability, budget fit, rating, past performance — and the
                  evidence behind it. A <Term name="matchScore">score</Term> with no evidence trail is not shown.
                </span>
              </p>
              <p className="inline-flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" strokeWidth={2.5} />
                <span>
                  <strong className="font-semibold text-ink">Invitation-first, not a bidding war.</strong> Clients see
                  a ranked shortlist, not an inbox. Experts are matched to briefs that fit their verified skill stack.
                </span>
              </p>
            </div>
          </div>
        </div>

        <Reveal className="rounded-card bg-white px-6 py-5 shadow-card ring-1 ring-line">
          <p className="text-center text-sm leading-relaxed text-ink-muted">
            An <Term name="advisoryEstimate">advisory estimate</Term> is a range, not a quote. Agents propose;{' '}
            <strong className="font-semibold text-ink">a person decides at every gate</strong> — who to hire, what to
            approve, and when money moves.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
