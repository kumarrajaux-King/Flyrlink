'use client';

/**
 * Pricing — landing copy §6. "One number. 10%."
 *
 * THE CALCULATOR, AND WHAT IT MUST NOT SAY
 *   §9 #14 blocks any stated tax-withholding rate or net-payout figure that
 *   implies one: withholding is not implemented and the rates are unconfirmed.
 *   So the calculator computes exactly one thing — the 10% commission — and
 *   labels its result "before any tax withheld", which is the approved
 *   microcopy from §6. It never shows a tax line, and it never shows a figure
 *   described as what the expert will receive in their bank account.
 *
 *   The rate itself comes from `COMMISSION_RATE`, the same constant the copy
 *   uses, so the prose and the arithmetic cannot disagree.
 *
 * The client column is the point of the section: clients pay no platform fee,
 * and the moment someone is deciding whether to fund a milestone is the worst
 * possible moment to introduce a surprise.
 */

import { useState } from 'react';

import { Container } from '../../ui/container';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { COMMISSION_RATE, PRICING_ROWS } from './content';
import { Term } from './glossary';

const PRESETS = [25_000, 50_000, 150_000, 400_000] as const;

/** Whole rupees, grouped Indian-style. The platform's launch currency is INR. */
const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function Pricing() {
  const [gross, setGross] = useState<number>(50_000);

  const fee = Math.round(gross * COMMISSION_RATE);
  const net = gross - fee;

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-canvas py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          id="pricing-title"
          align="center"
          eyebrow="Pricing"
          title={
            <>
              One number. <Accent>10%.</Accent>
            </>
          }
          description="Experts pay 10% of what they earn. Clients pay the milestone amount and nothing else — no posting fee, no contract fee, no fee to pay by UPI or card."
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PRICING_ROWS.map((row, index) => (
            <Reveal
              key={row.who}
              delay={index * 80}
              className="flex h-full flex-col gap-3 rounded-card bg-white p-7 shadow-card ring-1 ring-line"
            >
              <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-600 uppercase">{row.who}</p>
              <p className="text-2xl font-semibold tracking-[-0.02em] text-balance text-ink">{row.pays}</p>
              <p className="mt-auto text-sm leading-relaxed text-ink-muted">{row.when}</p>
            </Reveal>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          <Reveal className="flex flex-col justify-center gap-5 rounded-card bg-canvas-tint p-8 ring-1 ring-brand-100 sm:p-10">
            <p className="text-lg leading-relaxed text-pretty text-ink sm:text-xl sm:leading-relaxed">
              Ten percent, flat, on what an expert actually gets paid. Not on what they quote, not on what they
              invoice — on what clears <Term name="escrow">escrow</Term>.
            </p>
            <p className="text-base leading-relaxed text-pretty text-ink-muted">
              There is no tier to climb, no threshold that changes the rate mid-project, and no fee on a project that
              never funds. Clients are not charged a platform fee at all, because the moment someone is deciding
              whether to fund a <Term name="milestone">milestone</Term> is the worst possible moment to introduce a
              surprise.
            </p>
          </Reveal>

          {/* The calculator. One rate, one subtraction, and a plain statement of
              what it does not include. */}
          <Reveal
            delay={80}
            className="flex flex-col gap-6 rounded-card bg-navy-900 p-8 text-white shadow-[0_30px_60px_-30px_rgb(8_37_62/0.9)] sm:p-10"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-xl font-semibold tracking-[-0.02em]">What an expert keeps</h3>
              <p className="text-sm text-white/60">Move the slider, or pick a milestone amount.</p>
            </div>

            <div className="flex flex-col gap-3">
              <label htmlFor="pricing-gross" className="text-[13px] font-medium text-white/70">
                Milestone amount
              </label>
              <input
                id="pricing-gross"
                type="range"
                min={5_000}
                max={500_000}
                step={5_000}
                value={gross}
                onChange={(event) => setGross(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-accent-400"
              />
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={gross === preset}
                    onClick={() => setGross(preset)}
                    className={
                      gross === preset
                        ? 'cursor-pointer rounded-full bg-accent-500 px-3 py-1.5 text-[12px] font-semibold text-white'
                        : 'cursor-pointer rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/75 transition-colors hover:bg-white/20'
                    }
                  >
                    {RUPEES.format(preset)}
                  </button>
                ))}
              </div>
            </div>

            <dl className="flex flex-col gap-3 border-t border-white/12 pt-5" aria-live="polite">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-white/70">Milestone</dt>
                <dd className="text-lg font-semibold tabular-nums">{RUPEES.format(gross)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-white/70">Platform fee (10%)</dt>
                <dd className="text-lg font-semibold text-accent-300 tabular-nums">−{RUPEES.format(fee)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-white/12 pt-3">
                <dt className="text-[15px] font-semibold">Expert receives</dt>
                <dd className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">{RUPEES.format(net)}</dd>
              </div>
            </dl>

            <p className="text-[12px] leading-relaxed text-white/55">
              Before any tax withheld. Withheld tax is deposited against the expert’s PAN, not kept by us, and appears
              on their statement. The client pays {RUPEES.format(gross)} — there is no platform fee for clients.
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
