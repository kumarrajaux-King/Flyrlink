/**
 * How it works — the Figma "Find your expert in 5 simple steps" section: the
 * split headline with a dark pill CTA, and step cards with cyan icon tiles.
 * The five steps mirror the real Project lifecycle, from submission to
 * completion.
 */

import { Check } from 'lucide-react';

import { ButtonArrow, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { PROCESS_STEPS } from './content';

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="bg-canvas-subtle py-24 sm:py-32">
      <Container className="flex flex-col gap-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <SectionHeading
            id="how-title"
            eyebrow="How it works"
            title={
              <>
                From brief to done, <Accent>in five steps.</Accent>
              </>
            }
          />
          <div className="flex flex-col items-start gap-6 lg:items-end lg:text-right">
            <p className="max-w-md text-lg leading-relaxed text-ink-muted">
              One flow from first idea to final payment. AI prepares each step; you approve everything that matters.
            </p>
            <ButtonLink href="#describe" variant="dark" size="lg" className="pr-4">
              Start with your brief
              <ButtonArrow />
            </ButtonLink>
          </div>
        </div>

        <ol
          className={[
            'relative grid grid-cols-1 gap-5 lg:grid-cols-5 lg:gap-4',
            // Connector: vertical on small screens, horizontal through the nodes on large ones.
            'before:absolute before:top-6 before:bottom-6 before:left-[21px] before:w-px before:bg-linear-to-b before:from-brand-200 before:to-accent-300',
            'lg:before:top-[22px] lg:before:right-[10%] lg:before:bottom-auto lg:before:left-[10%] lg:before:h-px lg:before:w-auto lg:before:bg-linear-to-r lg:before:from-brand-200 lg:before:via-brand-400 lg:before:to-accent-400',
          ].join(' ')}
        >
          {PROCESS_STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <Reveal delay={index * 80} className="flex h-full gap-4 lg:flex-col lg:items-center">
                <span className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full bg-white text-[13px] font-semibold text-brand-600 shadow-card ring-1 ring-line tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-1 flex-col gap-3 rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow] duration-300 ease-soft hover:-translate-y-1 hover:shadow-card-hover hover:ring-brand-200 lg:w-full">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent-50 text-accent-600">
                    <Icon name={step.icon} className="size-5" />
                  </span>
                  <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-muted">{step.description}</p>
                  <p className="mt-auto inline-flex items-center gap-1.5 pt-2 text-[12px] font-medium text-positive">
                    <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
                    {step.detail}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
