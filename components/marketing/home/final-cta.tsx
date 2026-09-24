/**
 * Final CTA — the Figma deep-blue "Bring your audience" band, as a contained
 * luminous panel with the primary conversion and, beside it, the expert
 * acquisition card that the header's "Become an Expert" link anchors to.
 */

import { Check } from 'lucide-react';

import { ButtonArrow, ButtonLink } from '../../ui/button';
import { Container } from '../../ui/container';
import { Accent, Eyebrow } from '../../ui/section-heading';
import { PreviewActionButton } from '../preview-action';
import { PREVIEW_MESSAGES } from '../preview-events';

const EXPERT_BENEFITS = [
  'A verified profile clients can trust',
  'Matched to projects that fit your expertise',
  'Paid on approved milestones, held securely until then',
] as const;

export function FinalCta() {
  return (
    <section id="get-started" aria-labelledby="cta-title" className="bg-white py-24 sm:py-28">
      <Container>
        <div className="relative isolate overflow-hidden rounded-panel bg-silk px-6 py-14 text-white shadow-elevated sm:px-12 sm:py-16 lg:px-16 lg:py-20">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 opacity-35 [background-image:radial-gradient(rgb(255_255_255/0.3)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_85%_30%,black,transparent_65%)]"
          />
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
            <div className="flex flex-col items-start gap-6">
              <Eyebrow tone="dark">Get started</Eyebrow>
              <h2 id="cta-title" className="text-4xl leading-[1.04] font-semibold tracking-[-0.04em] text-balance sm:text-5xl lg:text-6xl">
                Build your team <Accent className="text-white">with confidence.</Accent>
              </h2>
              <p className="max-w-lg text-lg leading-relaxed text-white/75">
                Start with a sentence. Leave with a structured brief, verified experts and a plan where every payment
                waits for your approval.
              </p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <ButtonLink href="#describe" variant="light" size="lg" className="pr-4">
                  Post a Project
                  <ButtonArrow tone="dark" />
                </ButtonLink>
                <ButtonLink href="#experts" variant="glass" size="lg">
                  Find an Expert
                </ButtonLink>
              </div>
            </div>

            <div id="become-an-expert" className="surface-glass scroll-mt-28 rounded-card p-6 sm:p-8">
              <Eyebrow tone="dark">For experts</Eyebrow>
              <h3 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">Become an expert</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Get matched to briefs that fit your skills — not a race to the lowest bid.
              </p>
              <ul className="mt-5 flex flex-col gap-3 text-sm">
                {EXPERT_BENEFITS.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/15">
                      <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>
              <PreviewActionButton variant="light" size="md" className="mt-7 w-full" message={PREVIEW_MESSAGES.becomeExpert}>
                Apply as an expert
              </PreviewActionButton>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
