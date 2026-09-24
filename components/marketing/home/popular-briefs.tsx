'use client';

import { requestBriefAnalysis } from '../preview-events';

const POPULAR = [
  { label: 'Marketplace app', brief: 'A marketplace web app with escrow payments and messaging' },
  { label: 'AI assistant', brief: 'An AI assistant that answers customer questions from our docs' },
  { label: 'Mobile app', brief: 'A mobile app for booking and paying for fitness classes' },
  { label: 'Design system', brief: 'A brand identity and design system for our fintech startup' },
] as const;

/** The Figma "Popular:" chips — each one runs the AI discovery preview for that brief. */
export function PopularBriefs() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-medium text-ink-subtle">Popular:</span>
      {POPULAR.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => requestBriefAnalysis(item.brief)}
          className="cursor-pointer rounded-full bg-white px-3 py-1.5 text-[13px] text-ink-muted ring-1 ring-line transition-[color,box-shadow] duration-200 hover:text-brand-600 hover:ring-brand-200"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
