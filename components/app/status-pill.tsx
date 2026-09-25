/**
 * A project status, rendered as state rather than as a word.
 *
 * The tone carries meaning the label alone does not: what is waiting on the
 * customer, what is in flight, what has stopped. Colour is never the only
 * signal — the label is always present — so the distinction survives for anyone
 * who cannot see the difference.
 *
 * Every member of the `ProjectStatus` enum has an entry. A status with no tone
 * would fall back silently to neutral and quietly lose that meaning, so a test
 * pins the table against the state machine.
 */

import { cn } from '../../lib/ui/cn';

export type StatusTone = 'neutral' | 'active' | 'waiting' | 'good' | 'warn' | 'stopped';

export const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  DRAFT: 'neutral',
  SUBMITTED: 'active',
  AI_ANALYSIS: 'active',
  REQUIREMENT_REVIEW: 'waiting',
  MATCHING: 'active',
  RECOMMENDED: 'waiting',
  AWAITING_APPROVAL: 'waiting',
  ASSIGNMENT_PENDING: 'waiting',
  CONTRACT_PENDING: 'waiting',
  PAYMENT_PENDING: 'waiting',
  ACTIVE: 'active',
  AT_RISK: 'warn',
  COMPLETED: 'good',
  REVIEW_PENDING: 'waiting',
  CLOSED: 'good',
  CANCELLED: 'stopped',
  DISPUTED: 'warn',
  SUSPENDED: 'stopped',
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-canvas-subtle text-ink-muted ring-line',
  active: 'bg-brand-50 text-brand-700 ring-brand-200',
  waiting: 'bg-amber-50 text-amber-800 ring-amber-200',
  good: 'bg-positive-soft text-positive ring-green-200',
  warn: 'bg-red-50 text-red-700 ring-red-200',
  stopped: 'bg-canvas-subtle text-ink-subtle ring-line-strong',
};

/** `AWAITING_APPROVAL` reads as "Awaiting approval". */
export function humanise(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusPill({ status, className }: { readonly status: string; readonly className?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[12px] font-semibold whitespace-nowrap ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      {humanise(status)}
    </span>
  );
}
