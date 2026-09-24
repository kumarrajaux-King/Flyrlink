import { cn } from '../../lib/ui/cn';

const RADIUS = 17;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Circular AI match indicator (0–100). */
export function MatchMeter({
  score,
  label = 'AI match',
  showLabel = true,
  className,
}: {
  readonly score: number;
  readonly label?: string;
  readonly showLabel?: boolean;
  readonly className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative grid size-11 place-items-center">
        <svg viewBox="0 0 40 40" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
          <circle cx="20" cy="20" r={RADIUS} fill="none" strokeWidth="3.5" className="stroke-brand-100" />
          <circle
            cx="20"
            cy="20"
            r={RADIUS}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
            className="stroke-brand-500"
          />
        </svg>
        <span aria-hidden="true" className="text-[12px] font-semibold text-ink tabular-nums">
          {value}
        </span>
      </span>
      {showLabel ? (
        <span aria-hidden="true" className="flex flex-col leading-tight">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-brand-600 uppercase">{label}</span>
          <span className="text-[12px] text-ink-subtle">out of 100</span>
        </span>
      ) : null}
      <span className="sr-only">
        {label}: {value} out of 100
      </span>
    </span>
  );
}
