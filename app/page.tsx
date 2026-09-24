/**
 * `/` — Home Page preview.
 *
 * A client-preview Home Page for visual and UX evaluation, built on the Figma
 * design language and the reusable component layer (`components/ui`). It is
 * not the Phase 5 marketplace: actions that belong to later screens say so
 * instead of linking to pages that do not exist.
 *
 * Data: verified expert profiles and platform counts are read live from the
 * database (`getHomeShowcase`), which falls back silently when the database is
 * unavailable. Everything else illustrative is labelled on the page.
 */

import { AiAdvantage } from '../components/marketing/home/ai-advantage';
import { ExpertDiscovery } from '../components/marketing/home/expert-discovery';
import { FinalCta } from '../components/marketing/home/final-cta';
import { Hero } from '../components/marketing/home/hero';
import { HowItWorks } from '../components/marketing/home/how-it-works';
import { ProjectDiscovery } from '../components/marketing/home/project-discovery';
import { Trust } from '../components/marketing/home/trust';
import { PreviewBar } from '../components/marketing/preview-bar';
import { PreviewToast } from '../components/marketing/preview-toast';
import { SiteFooter } from '../components/marketing/site-footer';
import { SiteHeader } from '../components/marketing/site-header';
import { getHomeShowcase } from '../services/marketplace/home-showcase';

// Live showcase data is read per request, never baked in at build time.
export const dynamic = 'force-dynamic';

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
        <ProjectDiscovery />
        <ExpertDiscovery showcase={showcase} />
        <HowItWorks />
        <AiAdvantage />
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
      <PreviewToast />
    </>
  );
}
