/**
 * AI advantage — the agentic capabilities, each an implemented Phase 7 agent,
 * with the human-in-the-loop rule stated plainly beside them.
 */

import { ShieldCheck } from 'lucide-react';

import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { AI_CAPABILITIES } from './content';

export function AiAdvantage() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="bg-white py-24 sm:py-32">
      <Container className="grid grid-cols-1 gap-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
        <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            id="ai-title"
            eyebrow="AI advantage"
            title={
              <>
                Agents do the groundwork. <Accent>You make the calls.</Accent>
              </>
            }
            description="Specialised agents take on the slow, detailed work of scoping, estimating, matching and monitoring. Every output is explained, recorded, and yours to accept or change."
          />

          <div className="relative isolate overflow-hidden rounded-card bg-navy-800 p-7 text-white shadow-elevated">
            <div aria-hidden="true" className="absolute -top-20 -right-20 -z-10 size-56 rounded-full bg-brand-500/35 blur-3xl" />
            <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-accent-300">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em]">Human approval, built in</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Agents never move money, sign contracts or verify experts. Anything high-impact waits for a person, and
              every AI action is audited.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
              <div>
                <dt className="text-[12px] text-white/50">Specialised agents</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">13</dd>
              </div>
              <div>
                <dt className="text-[12px] text-white/50">AI actions audited</dt>
                <dd className="mt-1 text-2xl font-semibold">All of them</dd>
              </div>
            </dl>
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {AI_CAPABILITIES.map((capability, index) => (
            <li key={capability.title}>
              <Reveal delay={index * 70} className="h-full">
                <article className="group relative isolate flex h-full flex-col gap-4 overflow-hidden rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow] duration-300 ease-soft hover:-translate-y-1 hover:shadow-card-hover hover:ring-brand-200 sm:p-7">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-24 -right-24 -z-10 size-56 rounded-full bg-brand-100/70 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                  />
                  <span className="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-accent-500 text-white shadow-brand">
                    <Icon name={capability.icon} className="size-5" />
                  </span>
                  <h3 className="text-xl font-semibold tracking-[-0.02em] text-ink">{capability.title}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-muted">{capability.description}</p>
                  <p className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px]">
                    <span className="text-[11px] font-semibold tracking-[0.16em] text-ink-subtle uppercase">Output</span>
                    <span className="text-right font-medium text-ink">{capability.output}</span>
                  </p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
