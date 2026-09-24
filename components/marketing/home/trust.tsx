/**
 * Trust — the five protections, each backed by implemented controls, followed
 * by the Figma dark navy bar. Where the Figma bar shows marketplace counts,
 * this one states guarantees, since this preview has no real counts to show.
 */

import { ArrowRight, Check, FileCheck, LockKeyhole, ScrollText, ShieldCheck } from 'lucide-react';

import { cn } from '../../../lib/ui/cn';
import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { TRUST_PILLARS } from './content';

/** Protected-payment flow, as the Phase 6 contract, milestone and payment states move. */
const PAYMENT_FLOW = ['Contract signed', 'Milestone funded', 'Work approved', 'Released'] as const;

const VERIFICATION_CHECKS = ['Identity', 'Skills', 'Portfolio', 'Human review'] as const;

const GUARANTEES = [
  { icon: ShieldCheck, label: 'Payment confirmations verified with the provider' },
  { icon: FileCheck, label: 'Signed terms are versioned and immutable' },
  { icon: LockKeyhole, label: 'Funds released only on your approval' },
  { icon: ScrollText, label: 'Every sensitive action is audited' },
] as const;

/** Bento order: two wide cards, then three. Indexes into TRUST_PILLARS. */
const LAYOUT = [
  { index: 0, span: 'lg:col-span-3' },
  { index: 3, span: 'lg:col-span-3' },
  { index: 1, span: 'lg:col-span-2' },
  { index: 2, span: 'lg:col-span-2' },
  { index: 4, span: 'lg:col-span-2' },
] as const;

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="bg-canvas-tint py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          id="trust-title"
          align="center"
          eyebrow="Trust & safety"
          title={
            <>
              Protected at <Accent>every step.</Accent>
            </>
          }
          description="Verification, contracts, milestones and payments are built into the platform itself — not left to good intentions."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          {LAYOUT.map(({ index, span }, order) => {
            const pillar = TRUST_PILLARS[index];
            if (!pillar) return null;
            return (
              <Reveal key={pillar.title} delay={order * 70} className={cn('h-full', span)}>
                <article className="flex h-full flex-col gap-4 rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow] duration-300 ease-soft hover:-translate-y-1 hover:shadow-card-hover hover:ring-brand-200 sm:p-8">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon name={pillar.icon} className="size-5" />
                  </span>
                  <h3 className="text-xl font-semibold tracking-[-0.02em] text-ink">{pillar.title}</h3>
                  <p className="max-w-md text-[15px] leading-relaxed text-ink-muted">{pillar.description}</p>

                  {index === 0 ? (
                    <ul className="mt-auto flex flex-wrap gap-2 pt-2">
                      {VERIFICATION_CHECKS.map((check) => (
                        <li key={check} className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-3 py-1 text-[12px] font-medium text-positive">
                          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                          {check}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {index === 3 ? (
                    <ol className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                      {PAYMENT_FLOW.map((stage, stageIndex) => (
                        <li key={stage} className="inline-flex items-center gap-2">
                          <span
                            className={cn(
                              'rounded-full px-3 py-1 text-[12px] font-medium',
                              stageIndex === PAYMENT_FLOW.length - 1
                                ? 'bg-brand-500 text-white'
                                : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
                            )}
                          >
                            {stage}
                          </span>
                          {stageIndex < PAYMENT_FLOW.length - 1 ? (
                            <ArrowRight aria-hidden="true" className="size-3.5 text-brand-300" />
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </article>
              </Reveal>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 rounded-card bg-navy-800 px-6 py-7 text-white shadow-elevated sm:grid-cols-2 lg:grid-cols-4 lg:px-10 lg:py-8">
          {GUARANTEES.map(({ icon: Glyph, label }) => (
            <p key={label} className="flex items-center gap-3 text-sm leading-snug text-white/80">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8 text-accent-300">
                <Glyph aria-hidden="true" className="size-5" />
              </span>
              {label}
            </p>
          ))}
        </div>
      </Container>
    </section>
  );
}
