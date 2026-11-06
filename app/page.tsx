/**
 * `/` — Home Page preview.
 *
 * A client-preview Home Page for visual and UX evaluation, built on the Figma
 * design language and the reusable component layer (`components/ui`). It is
 * not the Phase 5 marketplace: actions that belong to later screens say so
 * instead of linking to pages that do not exist.
 *
 * CONTENT SOURCE
 *   Every claim, heading and CTA comes from `docs/content/landing-pages.md`, and
 *   the section order follows the public-zone row of
 *   `docs/architecture/information-architecture.md` §3. Nothing on this page
 *   asserts something the claims register (§9) does not substantiate — which is
 *   why there are no client logos, no testimonials, no volume counts, no
 *   time-to-shortlist figure, and no stated tax rate anywhere on it.
 *
 * DATA
 *   Verified expert profiles and platform counts are read live from the
 *   database (`getHomeShowcase`), which falls back silently when the database
 *   is unavailable. Everything else illustrative is labelled on the page.
 */

import type { Metadata } from 'next';

import { Engine } from '../components/marketing/home/engine';
import { Escrow } from '../components/marketing/home/escrow';
import { ExpertDiscovery } from '../components/marketing/home/expert-discovery';
import { FinalCta } from '../components/marketing/home/final-cta';
import { Hero } from '../components/marketing/home/hero';
import { Pricing } from '../components/marketing/home/pricing';
import { ProjectDiscovery } from '../components/marketing/home/project-discovery';
import { Trust } from '../components/marketing/home/trust';
import { TrustBadges } from '../components/marketing/home/trust-badges';
import { Verification } from '../components/marketing/home/verification';
import { PreviewBar } from '../components/marketing/preview-bar';
import { PreviewToast } from '../components/marketing/preview-toast';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteHeader } from '../components/marketing/site-header';
import { getHomeShowcase } from '../services/marketplace/home-showcase';

// Live showcase data is read per request, never baked in at build time.
export const dynamic = 'force-dynamic';

/**
 * Title tag and meta description are verbatim from landing-pages.md §8.
 *
 * `absolute` because the layout's `%s | Flyrlink` template applies to child
 * segments, and this page is the root segment itself — a plain string here
 * would ship the title without the brand suffix the copy specifies.
 */
export const metadata: Metadata = {
  title: { absolute: 'Hire verified experts, matched by AI | Flyrlink' },
  description:
    'Describe your project and get a shortlist of verified experts, with milestone escrow and contracts built in.',
};

export default async function HomePage() {
  const showcase = await getHomeShowcase(3);

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[80] rounded-full bg-navy-800 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <PreviewBar />
      <SiteHeader />
      <main id="main">
        <Hero />
        <TrustBadges />
        <ProjectDiscovery />
        <Engine />
        <ExpertDiscovery showcase={showcase} />
        <Verification />
        <Escrow />
        <Pricing />
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
      <PreviewToast />
    </>
  );
}
