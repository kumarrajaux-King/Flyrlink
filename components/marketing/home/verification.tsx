/**
 * Verified skill stack — landing copy §4.
 *
 * The sentence this section exists to deliver is the one in the pull quote: AI
 * never grants verification. Everything above it is the evidence for that
 * claim, and the fourth row — where the agent's output is shown to the public
 * as *nothing* — is the one that proves it.
 *
 * §9 forbids describing any of this as "cryptographic". It is document review
 * plus human judgement, recorded in an append-only trail, and the copy says
 * exactly that.
 */

import { Quote, X } from 'lucide-react';

import { Container } from '../../ui/container';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { VERIFICATION_ROWS } from './content';
import { Term } from './glossary';

/** Badge states, mapped from `VerificationStatus` exactly as §4 sets out. */
const BADGE_STATES = [
  { status: 'VERIFIED', shows: true },
  { status: 'PENDING', shows: false },
  { status: 'IN_REVIEW', shows: false },
  { status: 'REJECTED', shows: false },
  { status: 'EXPIRED', shows: false },
  { status: 'REVOKED', shows: false },
] as const;

export function Verification() {
  return (
    <section id="verification" aria-labelledby="verification-title" className="scroll-mt-20 bg-canvas py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          id="verification-title"
          align="center"
          eyebrow="Verified skill stack"
          title={
            <>
              Verification is a human decision, <Accent>recorded.</Accent>
            </>
          }
          description="Four things are checked, by a person, against evidence the expert submits. What the public sees is deliberately narrower than what the reviewer sees."
        />

        <Reveal className="overflow-hidden rounded-card bg-white shadow-card ring-1 ring-line">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">What is verified, how it is verified, and what the public sees</caption>
            <thead>
              <tr className="bg-canvas-subtle">
                {['What is verified', 'How', 'What the public sees'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-5 py-4 text-[11px] font-semibold tracking-[0.18em] text-ink-subtle uppercase sm:px-7"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {VERIFICATION_ROWS.map((row, index) => (
                <tr key={row.checked} className={index > 0 ? 'border-t border-line' : undefined}>
                  <th scope="row" className="px-5 py-5 align-top text-[15px] font-semibold text-ink sm:px-7">
                    {row.checked}
                  </th>
                  <td className="px-5 py-5 align-top text-sm leading-relaxed text-ink-muted sm:px-7">{row.how}</td>
                  <td className="px-5 py-5 align-top text-sm leading-relaxed sm:px-7">
                    {row.shown.startsWith('Nothing') ? (
                      <span className="inline-flex items-start gap-2 font-medium text-ink">
                        <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-subtle" strokeWidth={2.5} />
                        {row.shown}
                      </span>
                    ) : (
                      <span className="text-ink-muted">{row.shown}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal className="flex flex-col gap-4 rounded-card bg-navy-900 p-8 text-white sm:p-10">
            <Quote aria-hidden="true" className="size-7 text-accent-300" />
            <p className="text-xl leading-relaxed font-medium text-balance sm:text-2xl">
              AI never grants verification. A person reviews the evidence and decides, that decision is recorded
              against their name, and a badge can be withdrawn.
            </p>
          </Reveal>

          <Reveal delay={80} className="flex flex-col gap-5 rounded-card bg-canvas-subtle p-8 ring-1 ring-line sm:p-10">
            <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">
              When the <Term name="verified">verified</Term> badge shows
            </h3>
            <ul className="flex flex-col gap-2.5">
              {BADGE_STATES.map((state) => (
                <li key={state.status} className="flex items-center justify-between gap-4 text-sm">
                  <code className="font-mono text-[12px] tracking-tight text-ink-muted">{state.status}</code>
                  <span
                    className={
                      state.shows
                        ? 'rounded-full bg-positive-soft px-2.5 py-1 text-[12px] font-semibold text-positive'
                        : 'rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-ink-subtle ring-1 ring-line'
                    }
                  >
                    {state.shows ? 'Badge shown' : 'No badge'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-auto text-[13px] leading-relaxed text-ink-subtle">
              One state shows a badge. The other five do not — including a badge that has been withdrawn.
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
