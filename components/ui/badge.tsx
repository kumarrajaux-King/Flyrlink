import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/ui/cn';

export const badgeVariants = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium', {
  variants: {
    tone: {
      neutral: 'bg-canvas-subtle text-ink-muted ring-1 ring-line ring-inset',
      brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100 ring-inset',
      accent: 'bg-accent-50 text-accent-700 ring-1 ring-accent-100 ring-inset',
      positive: 'bg-positive-soft text-positive',
      /** Marks illustrative content. Deliberately visible. */
      sample: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 ring-inset',
      /** Marks data read from the platform. */
      live: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset',
      dark: 'bg-white/10 text-white ring-1 ring-white/15 ring-inset',
    },
    size: {
      sm: 'h-6 px-2.5 text-[11px]',
      md: 'h-7 px-3 text-xs',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
