/**
 * Hero — the Figma composition: a large headline, supporting copy, CTAs and
 * "Popular" chips on the left; a large rounded visual with floating cards on
 * the right. The photograph is replaced by a composed product visual (see
 * HeroVisual), and the copy speaks to the AI-agentic product, not bookings.
 */

import { BadgeCheck, LockKeyhole, Sparkles } from 'lucide-react';

import { ButtonArrow, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Accent } from '../../ui/section-heading';
import { HeroVisual } from './hero-visual';
import { PopularBriefs } from './popular-briefs';

const ASSURANCES = [
  { icon: BadgeCheck, label: 'Experts verified by people' },
  { icon: Sparkles, label: 'AI you can review and edit' },
  { icon: LockKeyhole, label: 'Paid only on your approval' },
] as const;

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 -left-40 size-[40rem] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute top-24 -right-40 size-[32rem] rounded-full bg-accent-100/50 blur-3xl" />
        <div className="absolute inset-0 bg-grid-faint [mask-image:radial-gradient(ellipse_at_30%_0%,black_5%,transparent_60%)]" />
      </div>

      <Container className="grid grid-cols-1 items-center gap-14 pt-8 pb-20 sm:pt-12 lg:grid-cols-[1.02fr_1fr] lg:gap-14 lg:pt-16 lg:pb-28">
        <div className="flex min-w-0 flex-col items-start gap-7">
          <a
            href="#ai"
            className="group inline-flex max-w-full items-center gap-2.5 rounded-full bg-white py-1 pr-3.5 pl-1 text-[13px] font-medium text-ink-muted shadow-card ring-1 ring-line transition-[box-shadow,color] duration-300 hover:text-ink hover:ring-brand-200"
          >
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white">
              <Sparkles aria-hidden="true" className="size-3" />
              AI agents
            </span>
            <span className="truncate">
              <span className="sm:hidden">Plan, match and monitor</span>
              <span className="hidden sm:inline">Plan, match and monitor — with you in control</span>
            </span>
            <span aria-hidden="true" className="text-brand-500 transition-transform duration-300 group-hover:translate-x-0.5">
              →
            </span>
          </a>

          <h1
            id="hero-title"
            className="text-[2.7rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-6xl xl:text-[4.4rem]"
          >
            Find the right expert or team, <Accent>matched by AI.</Accent>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink-muted sm:text-xl sm:leading-relaxed">
            Describe the outcome you need. Our agents structure the brief, estimate the work and recommend verified
            experts — with contracts, milestones and protected payments built in.
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href="#experts" size="lg" className="pr-4">
              Find an Expert
              <ButtonArrow />
            </ButtonLink>
            <ButtonLink href="#describe" variant="secondary" size="lg">
              Post a Project
            </ButtonLink>
          </div>

          <PopularBriefs />

          <ul className="flex w-full flex-wrap gap-x-6 gap-y-3 border-t border-line pt-6 text-[13px] text-ink-muted">
            {ASSURANCES.map(({ icon: Glyph, label }) => (
              <li key={label} className="inline-flex items-center gap-2">
                <Glyph aria-hidden="true" className="size-4 text-brand-500" strokeWidth={2} />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <HeroVisual />
      </Container>
    </section>
  );
}
