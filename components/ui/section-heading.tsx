/**
 * Section headings.
 *
 * The Figma headline voice: a tight, semibold sans sentence with an accent
 * phrase set in Georgia italic ("Find your expert *in 5 simple steps.*",
 * "Simple, transparent *pricing.*"), under a small, widely tracked eyebrow.
 */

import type { ReactNode } from 'react';

import { cn } from '../../lib/ui/cn';

export function Accent({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <em className={cn('font-accent font-normal tracking-[-0.02em] text-brand-500 italic', className)}>{children}</em>
  );
}

export function Eyebrow({
  children,
  tone = 'light',
  className,
}: {
  readonly children: ReactNode;
  readonly tone?: 'light' | 'dark';
  readonly className?: string;
}) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase',
        tone === 'dark' ? 'text-accent-300' : 'text-brand-600',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone === 'dark' ? 'bg-accent-300' : 'bg-brand-500')} />
      {children}
    </p>
  );
}

export interface SectionHeadingProps {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly align?: 'left' | 'center';
  readonly tone?: 'light' | 'dark';
  readonly id?: string;
  readonly className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  tone = 'light',
  id,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('flex max-w-3xl flex-col gap-4', align === 'center' && 'mx-auto items-center text-center', className)}>
      {eyebrow ? <Eyebrow tone={tone}>{eyebrow}</Eyebrow> : null}
      <h2
        id={id}
        className={cn(
          'text-[2.25rem] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[3.25rem]',
          tone === 'dark' ? 'text-white' : 'text-ink',
        )}
      >
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            'max-w-2xl text-base leading-relaxed text-pretty sm:text-lg',
            tone === 'dark' ? 'text-white/70' : 'text-ink-muted',
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
