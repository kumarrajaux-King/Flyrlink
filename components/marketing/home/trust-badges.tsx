/**
 * The four trust badges — landing copy §7.2.
 *
 * A short band, placed where a marketplace page usually puts client logos.
 * There are no client logos, no testimonials and no volume counts anywhere on
 * this page: §9 #17 blocks all three, because none of them exist yet and
 * inventing them is exactly the kind of thing the claims register is for.
 *
 * Each badge is a claim the register marks SUBSTANTIATED, and each links to the
 * section on this page that shows its working.
 */

import { ArrowUpRight } from 'lucide-react';

import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { TRUST_BADGES } from './content';

/** Where each badge's evidence lives on this page. */
const EVIDENCE: Readonly<Record<string, string>> = {
  'Verified by people': '#verification',
  'Milestone escrow': '#escrow',
  'Dispute cover': '#escrow',
  'Audit trail': '#trust',
};

export function TrustBadges() {
  return (
    <section aria-label="What protects both sides" className="border-y border-line bg-canvas-subtle py-12 sm:py-16">
      <Container>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_BADGES.map((badge, index) => (
            <li key={badge.title}>
              <Reveal delay={index * 70} className="h-full">
                <a
                  href={EVIDENCE[badge.title] ?? '#trust'}
                  className="group flex h-full flex-col gap-3 rounded-card bg-white p-6 shadow-card ring-1 ring-line transition-[translate,box-shadow,color] duration-300 ease-soft hover:-translate-y-1 hover:shadow-card-hover hover:ring-brand-200"
                >
                  <span className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon name={badge.icon} className="size-5" />
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 text-ink-subtle transition-colors duration-300 group-hover:text-brand-500"
                    />
                  </span>
                  <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{badge.title}</span>
                  <span className="text-[13px] leading-relaxed text-ink-muted">{badge.description}</span>
                </a>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
