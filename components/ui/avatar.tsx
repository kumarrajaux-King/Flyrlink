/**
 * Monogram avatar.
 *
 * Used instead of photographs until licensed imagery exists (M-02): no stock
 * portrait is ever presented as a real expert.
 */

import { cn } from '../../lib/ui/cn';

export type AvatarTone = 'sky' | 'indigo' | 'teal' | 'amber' | 'rose' | 'slate';

const TONES: Readonly<Record<AvatarTone, string>> = {
  sky: 'from-sky-100 via-brand-100 to-brand-300 text-brand-900',
  indigo: 'from-indigo-50 via-indigo-100 to-indigo-300 text-indigo-900',
  teal: 'from-teal-50 via-accent-100 to-accent-300 text-accent-700',
  amber: 'from-amber-50 via-amber-100 to-amber-300 text-amber-900',
  rose: 'from-rose-50 via-rose-100 to-rose-300 text-rose-900',
  slate: 'from-slate-50 via-slate-100 to-slate-300 text-slate-800',
};

const SIZES = {
  sm: 'size-8 text-[11px]',
  md: 'size-11 text-sm',
  lg: 'size-16 text-lg',
} as const;

export interface AvatarProps {
  readonly initials: string;
  readonly tone: AvatarTone;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}

export function Avatar({ initials, tone, size = 'md', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full bg-linear-to-br font-semibold tracking-[-0.02em] select-none',
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
