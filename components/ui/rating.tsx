import { Star } from 'lucide-react';

import { cn } from '../../lib/ui/cn';

function StarRow({ className }: { readonly className: string }) {
  return (
    <span className={cn('flex w-max gap-0.5', className)}>
      {[0, 1, 2, 3, 4].map((index) => (
        <Star key={index} className="size-3.5 fill-current" strokeWidth={0} />
      ))}
    </span>
  );
}

/** Five stars with a fractional fill, the numeric value, and the review count. */
export function Rating({
  value,
  count,
  className,
}: {
  readonly value: number;
  readonly count?: number | undefined;
  readonly className?: string;
}) {
  const fill = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span aria-hidden="true" className="relative inline-flex">
        <StarRow className="text-line-strong" />
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill}%` }}>
          <StarRow className="text-star" />
        </span>
      </span>
      <span aria-hidden="true" className="text-[13px] font-semibold text-ink tabular-nums">
        {value.toFixed(1)}
      </span>
      {count !== undefined ? (
        <span aria-hidden="true" className="text-[13px] text-ink-subtle tabular-nums">
          ({count})
        </span>
      ) : null}
      <span className="sr-only">
        Rated {value.toFixed(1)} out of 5{count !== undefined ? `, ${count} reviews` : ''}
      </span>
    </span>
  );
}
