'use client';

/**
 * Hero — the Figma composition (large headline, supporting copy, CTAs and
 * "Popular" chips on the left; a rounded visual with floating cards on the
 * right), carrying the §2 landing copy.
 *
 * THE AUDIENCE SWITCHER
 *   The copy defines three heroes — client, expert, enterprise — that live on
 *   three routes. Those routes do not exist yet, so rather than link to
 *   nothing, the preview swaps the copy in place. A reviewer can read all three
 *   and judge whether the positioning holds together, which is the question
 *   this preview exists to answer.
 *
 *   Only the client hero is the page's `<h1>`: switching changes the text
 *   inside that one heading, so the page never has two.
 *
 * The headline is variant A, the control from §2.1 — outcome-led, and free of
 * the time-to-shortlist promise that §9 holds as unsubstantiated.
 */

import { BadgeCheck, LockKeyhole, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../../lib/ui/cn';
import { ButtonArrow, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Accent } from '../../ui/section-heading';
import { PreviewActionButton } from '../preview-action';
import { PREVIEW_MESSAGES } from '../preview-events';
import { HERO_AUDIENCES, type HeroAudience } from './content';
import { HeroVisual } from './hero-visual';
import { PopularBriefs } from './popular-briefs';

const ASSURANCE_ICONS = [BadgeCheck, Sparkles, LockKeyhole] as const;

/** Where a hero's primary CTA goes, when it goes anywhere on this page. */
function primaryHref(audience: HeroAudience): string | null {
  return audience.key === 'CLIENT' ? '#experts' : null;
}

function secondaryHref(audience: HeroAudience): string | null {
  switch (audience.key) {
    case 'CLIENT':
      return '#describe';
    case 'EXPERT':
      return '#how-it-works';
    default:
      return '#escrow';
  }
}

export function Hero() {
  const [active, setActive] = useState<HeroAudience>(HERO_AUDIENCES[0]!);

  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 -left-40 size-[40rem] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute top-24 -right-40 size-[32rem] rounded-full bg-accent-100/50 blur-3xl" />
        <div className="absolute inset-0 bg-grid-faint [mask-image:radial-gradient(ellipse_at_30%_0%,black_5%,transparent_60%)]" />
      </div>

      <Container className="grid grid-cols-1 items-center gap-14 pt-8 pb-20 sm:pt-12 lg:grid-cols-[1.02fr_1fr] lg:gap-14 lg:pt-16 lg:pb-28">
        <div className="flex min-w-0 flex-col items-start gap-7">
          <div
            role="tablist"
            aria-label="Choose an audience"
            className="inline-flex rounded-full bg-white/80 p-1 shadow-card ring-1 ring-line backdrop-blur"
          >
            {HERO_AUDIENCES.map((audience) => {
              const selected = audience.key === active.key;
              return (
                <button
                  key={audience.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(audience)}
                  className={cn(
                    'cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors duration-300',
                    selected ? 'bg-brand-500 text-white shadow-brand' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {audience.tab}
                </button>
              );
            })}
          </div>

          {/* One h1 for the page; the switcher changes the words inside it. */}
          <h1
            id="hero-title"
            className="text-[2.7rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-ink sm:text-6xl xl:text-[4.4rem]"
          >
            {active.headline} <Accent>{active.headlineAccent}</Accent>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink-muted sm:text-xl sm:leading-relaxed">
            {active.subhead}
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {primaryHref(active) ? (
              <ButtonLink href={primaryHref(active)!} size="lg" className="pr-4">
                {active.primaryCta}
                <ButtonArrow />
              </ButtonLink>
            ) : (
              <PreviewActionButton
                size="lg"
                className="pr-4"
                message={
                  active.key === 'EXPERT' ? PREVIEW_MESSAGES.becomeExpert : PREVIEW_MESSAGES.enterpriseContact
                }
              >
                {active.primaryCta}
                <ButtonArrow />
              </PreviewActionButton>
            )}
            <ButtonLink href={secondaryHref(active)!} variant="secondary" size="lg">
              {active.secondaryCta}
            </ButtonLink>
          </div>

          {active.key === 'CLIENT' ? <PopularBriefs /> : null}

          <ul className="flex w-full flex-wrap gap-x-6 gap-y-3 border-t border-line pt-6 text-[13px] text-ink-muted">
            {active.assurances.map((label, index) => {
              const Glyph = ASSURANCE_ICONS[index] ?? BadgeCheck;
              return (
                <li key={label} className="inline-flex items-center gap-2">
                  <Glyph aria-hidden="true" className="size-4 text-brand-500" strokeWidth={2} />
                  {label}
                </li>
              );
            })}
          </ul>

          {active.key !== 'CLIENT' ? (
            <p className="text-[12px] text-ink-subtle">
              This copy belongs to <code className="font-mono text-[11px] text-ink-muted">{active.route}</code>. The
              page is not built yet, so the preview shows it here.
            </p>
          ) : null}
        </div>

        <HeroVisual />
      </Container>
    </section>
  );
}
