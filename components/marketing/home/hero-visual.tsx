/**
 * Hero visual.
 *
 * The Figma hero pairs a large rounded photograph with floating profile chips.
 * No licensed photography exists yet (M-02), and a stock photo would imply real
 * people. So the same composition — large rounded panel, floating cards — is
 * built from the product itself: an AI-structured brief, a matched expert and a
 * protected milestone. Captioned as illustrative.
 */

import { BadgeCheck, Check, LockKeyhole, Sparkles } from 'lucide-react';

import { Avatar } from '../../ui/avatar';
import { MatchMeter } from '../../ui/match-meter';

export function HeroVisual() {
  return (
    <figure className="relative mx-auto w-full max-w-[36rem] lg:max-w-none">
      <div className="relative flex flex-col gap-3 overflow-hidden rounded-[2rem] bg-silk p-4 shadow-elevated ring-1 ring-brand-900/10 sm:block sm:aspect-[1.06/1] sm:p-0">
        <div aria-hidden="true" className="absolute -top-28 -right-28 size-96 rounded-full bg-white/25 blur-3xl" />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgb(255_255_255/0.35)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(140deg,black,transparent_55%)]"
        />

        {/* AI-structured brief */}
        <div className="relative rounded-2xl bg-white/95 p-4 shadow-card-hover ring-1 ring-white/70 backdrop-blur sm:absolute sm:top-[7%] sm:left-[6%] sm:w-[62%] sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Sparkles aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">Project brief</p>
              <p className="truncate text-[11px] text-ink-subtle">Requirements Analyst</p>
            </div>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[10px] font-semibold text-positive">
              <Check aria-hidden="true" className="size-3" strokeWidth={3} />
              Ready
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-ink-muted">
            “A marketplace for local tutors with scheduling and secure payments.”
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['Objective', 'Scope · 3', 'Milestones · 4'].map((label) => (
              <span key={label} className="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700">
                {label}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-canvas-subtle px-3 py-2 text-[11px]">
            <span className="text-ink-subtle">Advisory estimate</span>
            <span className="font-semibold text-ink tabular-nums">8–12 wks · ₹7L–₹15L</span>
          </div>
        </div>

        {/* Matched expert */}
        <div className="relative rounded-2xl bg-white p-4 shadow-elevated ring-1 ring-black/5 sm:absolute sm:top-[43%] sm:right-[5%] sm:w-[58%] sm:animate-float sm:p-5">
          <div className="flex items-center gap-3">
            <Avatar initials="AR" tone="sky" />
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-semibold text-ink">
                Ananya R.
                <BadgeCheck aria-hidden="true" className="size-4 text-brand-500" />
              </p>
              <p className="truncate text-[12px] text-ink-subtle">Full-stack engineer · 9 years</p>
            </div>
            <MatchMeter score={96} showLabel={false} className="ml-auto" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['TypeScript', 'React', 'Payments'].map((skill) => (
              <span key={skill} className="rounded-full bg-canvas-subtle px-2.5 py-1 text-[11px] text-ink-muted ring-1 ring-line">
                {skill}
              </span>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-brand-700">
            <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Shipped 3 marketplaces with escrow payments
          </p>
        </div>

        {/* Protected milestone */}
        <div className="surface-glass relative rounded-2xl p-4 text-white shadow-card sm:absolute sm:bottom-[6%] sm:left-[6%] sm:w-[52%] sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/15">
              <LockKeyhole aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Milestone 2 · Funded</p>
              <p className="truncate text-[11px] text-white/70">Released only on your approval</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full w-[62%] rounded-full bg-linear-to-r from-accent-300 to-white" />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-white/75">
            <span>In review</span>
            <span className="tabular-nums">62%</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-ink-subtle">Illustrative product preview — not live data</figcaption>
    </figure>
  );
}
