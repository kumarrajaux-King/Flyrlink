/**
 * Expert card — reusable for Browse Experts, recommendations and dashboards.
 *
 * Follows the Figma `Card/Expert Profile` anatomy: a gradient header carrying
 * the Verified badge, an overlapping avatar, name and headline, rating, skills,
 * price and availability. Adapted per R-3: price is "₹X /hr", never per
 * session; and it adds the AI match indicator with its reason.
 *
 * Every card states its source: a live profile read from the platform, or a
 * sample.
 */

import { BadgeCheck, Briefcase, CircleCheck, Sparkles } from 'lucide-react';

import { cn } from '../../lib/ui/cn';
import { PreviewActionButton } from '../marketing/preview-action';
import { PREVIEW_MESSAGES } from '../marketing/preview-events';
import { Avatar, type AvatarTone } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { MatchMeter } from '../ui/match-meter';
import { MoneyAmount } from '../ui/money';
import { Rating } from '../ui/rating';

export interface ExpertCardData {
  readonly key: string;
  readonly source: 'live' | 'sample';
  readonly displayName: string;
  readonly initials: string;
  readonly tone: AvatarTone;
  readonly headline: string;
  readonly rating: number | null;
  readonly reviewCount: number;
  readonly yearsOfExperience: number;
  readonly completedProjects: number;
  readonly skills: readonly string[];
  readonly hourlyRateMinor: string | null;
  readonly currency: string;
  readonly availability: string;
  readonly match: { readonly score: number; readonly reason: string } | null;
}

const AVAILABILITY: Readonly<Record<string, { readonly label: string; readonly dot: string }>> = {
  AVAILABLE: { label: 'Available now', dot: 'bg-emerald-500' },
  PARTIALLY_AVAILABLE: { label: 'Limited availability', dot: 'bg-amber-400' },
};

export function ExpertCard({ expert, className }: { readonly expert: ExpertCardData; readonly className?: string }) {
  const availability = AVAILABILITY[expert.availability] ?? { label: 'Not taking work', dot: 'bg-line-strong' };

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-card bg-white shadow-card ring-1 ring-line',
        'transition-[translate,box-shadow] duration-300 ease-soft hover:-translate-y-1 hover:shadow-card-hover hover:ring-brand-200',
        className,
      )}
    >
      <div className="relative h-24 bg-linear-to-br from-brand-100 via-brand-50 to-accent-50">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-70 [background-image:radial-gradient(rgb(42_129_210/0.16)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:linear-gradient(to_left,black,transparent_80%)]"
        />
        <div className="absolute top-3 left-3">
          {expert.source === 'live' ? <Badge tone="live">Live profile</Badge> : <Badge tone="sample">Sample profile</Badge>}
        </div>
        <div className="absolute top-3 right-3">
          <Badge tone="brand" className="bg-white/90">
            <BadgeCheck aria-hidden="true" className="size-3.5" />
            Verified
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 pb-5">
        {/* Positioned so the overlapping avatar paints above the (positioned) header band. */}
        <div className="relative z-10 -mt-8 flex items-end justify-between gap-3">
          <Avatar initials={expert.initials} tone={expert.tone} size="lg" className="shadow-card ring-4 ring-white" />
          {expert.match ? (
            <MatchMeter score={expert.match.score} />
          ) : (
            <span className="max-w-[10rem] pb-1 text-right text-[11px] leading-snug text-ink-subtle">
              AI match appears once you describe a project
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {expert.displayName}
            <BadgeCheck aria-hidden="true" className="size-4 text-brand-500" />
            <span className="sr-only">(verified)</span>
          </h3>
          <p className="line-clamp-1 text-sm text-ink-muted">{expert.headline}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-muted">
          {expert.rating !== null ? (
            <Rating value={expert.rating} count={expert.reviewCount} />
          ) : (
            <span className="text-ink-subtle">No reviews yet</span>
          )}
          <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
          <span className="inline-flex items-center gap-1">
            <Briefcase aria-hidden="true" className="size-3.5 text-ink-subtle" />
            {expert.yearsOfExperience} yrs
          </span>
          <span className="inline-flex items-center gap-1">
            <CircleCheck aria-hidden="true" className="size-3.5 text-ink-subtle" />
            {expert.completedProjects} projects
          </span>
        </div>

        <ul aria-label="Skills" className="flex flex-wrap gap-1.5">
          {expert.skills.map((skill) => (
            <li key={skill} className="rounded-full bg-canvas-subtle px-2.5 py-1 text-[12px] text-ink-muted ring-1 ring-line">
              {skill}
            </li>
          ))}
        </ul>

        {expert.match ? (
          <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[13px] leading-snug text-brand-700">
            <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {expert.match.reason}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex flex-col gap-0.5">
            {expert.hourlyRateMinor ? (
              <MoneyAmount minor={expert.hourlyRateMinor} currency={expert.currency} suffix=" /hr" className="text-[15px]" />
            ) : (
              <span className="text-sm text-ink-muted">Rate on request</span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-subtle">
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', availability.dot)} />
              {availability.label}
            </span>
          </div>
          <PreviewActionButton variant="secondary" size="sm" message={PREVIEW_MESSAGES.expertProfile}>
            View profile
          </PreviewActionButton>
        </div>
      </div>
    </article>
  );
}
