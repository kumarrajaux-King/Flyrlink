'use client';

/**
 * Escrow and security — landing copy §5.
 *
 * "Your money moves when you say so." The five stages are steppable, because
 * the shape of the thing — money stops at Fund, and only the client's approval
 * moves it on — is easier to believe when you can walk it.
 *
 * TWO WORDINGS THAT ARE NOT NEGOTIABLE
 *   §9 #13 blocks "Flyrlink holds your money in escrow": we do not hold it, our
 *   payment partner does, and the escrow policy explains why that distinction is
 *   not cosmetic. And §9 #16 blocks any mention of automatic release after an
 *   inspection period — it is not implemented — so release here is always an
 *   act by a person.
 */

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../../lib/ui/cn';
import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { ESCROW_STAGES, SECURITY_PROOFS } from './content';
import { Term } from './glossary';

export function Escrow() {
  const [index, setIndex] = useState(0);

  return (
    <section id="escrow" aria-labelledby="escrow-title" className="scroll-mt-20 bg-canvas-tint py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          id="escrow-title"
          eyebrow="Escrow & security"
          title={
            <>
              Your money moves <Accent>when you say so.</Accent>
            </>
          }
          description={
            <>
              Funds for a <Term name="milestone">milestone</Term> are held by our payment partner in{' '}
              <Term name="escrow">escrow</Term>, and reach the expert only after you approve the work.
            </>
          }
        />

        <div className="flex flex-col gap-8">
          {/* The rail. Each stage is a button; the selected one expands below. */}
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {ESCROW_STAGES.map((stage, position) => {
              const selected = position === index;
              const passed = position < index;
              return (
                <li key={stage.stage}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setIndex(position)}
                    className={cn(
                      'group flex w-full cursor-pointer flex-col gap-3 rounded-card p-5 text-left ring-1 transition-[background-color,box-shadow,translate] duration-300 ease-soft',
                      selected
                        ? 'bg-navy-900 text-white ring-navy-900'
                        : 'bg-white ring-line hover:-translate-y-0.5 hover:shadow-card-hover hover:ring-brand-200',
                    )}
                  >
                    <span className="flex items-center justify-between">
                      <span
                        className={cn(
                          'grid size-10 place-items-center rounded-xl transition-colors duration-300',
                          selected
                            ? 'bg-white/12 text-accent-300'
                            : passed
                              ? 'bg-positive-soft text-positive'
                              : 'bg-brand-50 text-brand-600',
                        )}
                      >
                        <Icon name={stage.icon} className="size-5" />
                      </span>
                      <span
                        className={cn(
                          'text-[11px] font-semibold tracking-[0.18em] uppercase tabular-nums',
                          selected ? 'text-white/50' : 'text-ink-subtle',
                        )}
                      >
                        {String(position + 1).padStart(2, '0')}
                      </span>
                    </span>
                    <span className={cn('text-[15px] font-semibold tracking-[-0.01em]', selected ? 'text-white' : 'text-ink')}>
                      {stage.stage}
                    </span>
                    <span className={cn('text-[13px] leading-relaxed', selected ? 'text-white/70' : 'text-ink-subtle')}>
                      {stage.happens}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Reveal className="flex flex-col gap-3 rounded-card bg-white p-7 shadow-card ring-1 ring-line sm:flex-row sm:items-center sm:gap-6 sm:p-8">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-brand-600 uppercase">
              <ChevronRight aria-hidden="true" className="size-4" />
              Your control at “{ESCROW_STAGES[index]!.stage}”
            </span>
            <p className="text-[15px] leading-relaxed text-ink sm:text-lg">{ESCROW_STAGES[index]!.control}</p>
          </Reveal>
        </div>

        <div className="flex flex-col gap-6 rounded-card bg-white p-8 shadow-card ring-1 ring-line sm:p-10">
          <h3 className="text-xl font-semibold tracking-[-0.02em] text-ink">
            Security proof points — all implemented today
          </h3>
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {SECURITY_PROOFS.map((proof, position) => (
              <li key={proof} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-600 tabular-nums">
                  {String(position + 1).padStart(2, '0')}
                </span>
                <p className="text-sm leading-relaxed text-ink-muted">{proof}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-line pt-5 text-[13px] leading-relaxed text-ink-subtle">
            Release is an act by a person holding a finance role, not a timer. There is no automatic release after an{' '}
            <Term name="inspectionPeriod">inspection period</Term>.
          </p>
        </div>
      </Container>
    </section>
  );
}
