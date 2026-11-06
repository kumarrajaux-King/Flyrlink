'use client';

/**
 * Expert discovery — the Figma "Popular services" rail and "Browse Expert"
 * cards, combined: category tiles that filter a grid of expert cards.
 *
 * Live verified experts from the platform lead the grid (marked "Live
 * profile"); sample profiles fill it out (marked "Sample profile"). Category
 * counts are samples and say so.
 */

import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { HomeShowcase, ShowcaseExpert } from '../../../services/marketplace/home-showcase';
import { cn } from '../../../lib/ui/cn';
import { ExpertCard, type ExpertCardData } from '../../marketplace/expert-card';
import type { AvatarTone } from '../../ui/avatar';
import { Badge } from '../../ui/badge';
import { ButtonArrow } from '../../ui/button';
import { Container } from '../../ui/container';
import { Icon } from '../../ui/icon';
import { Reveal } from '../../ui/reveal';
import { Accent, SectionHeading } from '../../ui/section-heading';
import { PreviewActionButton } from '../preview-action';
import { PREVIEW_MESSAGES } from '../preview-events';
import { SAMPLE_CATEGORIES, SAMPLE_EXPERTS, type SampleExpert } from './content';

const ALL = 'All';
const GRID_SIZE = 6;
const LIVE_TONES: readonly AvatarTone[] = ['sky', 'teal', 'indigo'];

function fromLive(expert: ShowcaseExpert, index: number): ExpertCardData {
  return {
    key: `live-${expert.slug}`,
    source: 'live',
    displayName: expert.displayName,
    initials: expert.initials,
    tone: LIVE_TONES[index % LIVE_TONES.length] ?? 'sky',
    headline: expert.headline,
    rating: expert.rating,
    reviewCount: expert.reviewCount,
    yearsOfExperience: expert.yearsOfExperience,
    completedProjects: expert.completedProjects,
    skills: expert.skills,
    hourlyRateMinor: expert.hourlyRateMinor,
    currency: expert.currency,
    availability: expert.availability,
    // No project context yet, so no score is invented for a real person.
    match: null,
  };
}

function fromSample(expert: SampleExpert): ExpertCardData {
  return {
    key: expert.id,
    source: 'sample',
    displayName: expert.displayName,
    initials: expert.initials,
    tone: expert.tone,
    headline: expert.headline,
    rating: expert.rating,
    reviewCount: expert.reviewCount,
    yearsOfExperience: expert.yearsOfExperience,
    completedProjects: expert.completedProjects,
    skills: expert.skills,
    hourlyRateMinor: expert.hourlyRateMinor,
    currency: 'INR',
    availability: expert.availability,
    match: { score: expert.matchScore, reason: expert.matchReason },
  };
}

export function ExpertDiscovery({ showcase }: { readonly showcase: HomeShowcase }) {
  const [category, setCategory] = useState<string>(ALL);

  const cards = useMemo(() => {
    if (category !== ALL) {
      return SAMPLE_EXPERTS.filter((expert) => expert.category === category).map(fromSample);
    }
    const live = showcase.experts.map(fromLive);
    const samples = SAMPLE_EXPERTS.slice(0, Math.max(0, GRID_SIZE - live.length)).map(fromSample);
    return [...live, ...samples];
  }, [category, showcase.experts]);

  const stats = showcase.source === 'live' ? showcase.stats : null;

  return (
    <section id="experts" aria-labelledby="experts-title" className="scroll-mt-20 bg-canvas-tint py-24 sm:py-32">
      <Container className="flex flex-col gap-14">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeading
            id="experts-title"
            eyebrow="Expert discovery"
            title={
              <>
                Verified experts, <Accent>ranked for your project.</Accent>
              </>
            }
            description="Browse by category, or describe your project and let matching rank experts on skills, delivery history, availability and budget fit."
          />
          <PreviewActionButton
            variant="dark"
            size="lg"
            className="self-start pr-4 lg:self-auto"
            message={PREVIEW_MESSAGES.browseExperts}
          >
            Browse all experts
            <ButtonArrow />
          </PreviewActionButton>
        </div>

        <div id="categories" className="flex scroll-mt-28 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">Popular categories</h3>
            <Badge tone="sample">Sample categories</Badge>
          </div>
          <div
            role="group"
            aria-label="Filter experts by category"
            className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4"
          >
            {SAMPLE_CATEGORIES.map((item) => {
              const active = category === item.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(active ? ALL : item.name)}
                  className={cn(
                    'group flex w-60 shrink-0 cursor-pointer snap-start flex-col gap-4 rounded-card p-5 text-left ring-1 sm:w-auto',
                    'transition-[background-color,box-shadow,translate,color] duration-300 ease-soft hover:-translate-y-0.5',
                    active
                      ? 'bg-brand-500 text-white shadow-brand ring-brand-500'
                      : 'bg-white text-ink shadow-card ring-line hover:shadow-card-hover hover:ring-brand-200',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-11 place-items-center rounded-xl transition-colors duration-300',
                      active ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-600 group-hover:bg-brand-100',
                    )}
                  >
                    <Icon name={item.icon} className="size-5" />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-[15px] font-semibold tracking-[-0.01em]">{item.name}</span>
                    <span className={cn('text-[13px]', active ? 'text-white/75' : 'text-ink-subtle')}>
                      {item.topSkills.join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" aria-live="polite">
              <span className="font-semibold text-ink">{category === ALL ? 'Top profiles' : category}</span> ·{' '}
              {cards.length} {cards.length === 1 ? 'profile' : 'profiles'}
              {category !== ALL ? (
                <button
                  type="button"
                  onClick={() => setCategory(ALL)}
                  className="ml-3 cursor-pointer font-medium text-brand-600 hover:text-brand-700"
                >
                  Show all
                </button>
              ) : null}
            </p>
            {stats ? (
              <p className="inline-flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                <Badge tone="live">
                  <Activity aria-hidden="true" className="size-3" />
                  Live
                </Badge>
                {stats.verifiedExperts} verified {stats.verifiedExperts === 1 ? 'expert' : 'experts'} ·{' '}
                {stats.categories} categories · {stats.activeServices} active{' '}
                {stats.activeServices === 1 ? 'service' : 'services'} on this environment
              </p>
            ) : null}
          </div>

          {cards.length > 0 ? (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <li key={card.key}>
                  <Reveal delay={index * 60} className="h-full">
                    <ExpertCard expert={card} />
                  </Reveal>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
              <p className="text-base font-semibold text-ink">No sample profiles in {category} yet</p>
              <p className="max-w-md text-sm text-ink-muted">
                In the full product this shows every verified expert in the category, ranked for your brief.
              </p>
              <button
                type="button"
                onClick={() => setCategory(ALL)}
                className="mt-1 cursor-pointer text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                Show all profiles
              </button>
            </div>
          )}

          <p className="text-[13px] leading-relaxed text-ink-subtle">
            Sample profiles are illustrative: their names, ratings, prices and match scores are not real people or data.
            {showcase.source === 'live' ? ' Live profiles are read from the platform database.' : ''}
          </p>
        </div>
      </Container>
    </section>
  );
}
