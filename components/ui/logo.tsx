import { cn } from '../../lib/ui/cn';

/**
 * Flyrlink wordmark with a provisional mark.
 *
 * The real logo asset has not been supplied (M-02), so the mark is a simple
 * placeholder in the brand colours — it does not reproduce any other brand.
 */
export function Logo({ tone = 'light', className }: { readonly tone?: 'light' | 'dark'; readonly className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-8 shrink-0">
        <rect width="32" height="32" rx="10" className="fill-brand-500" />
        <path d="M12.6 23.5v-9.1c0-3.1 1.9-4.9 4.8-4.9h2.3" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M9.6 15.4h8.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="22.3" cy="21.6" r="2.3" className="fill-accent-300" />
      </svg>
      <span className={cn('text-[19px] font-semibold tracking-[-0.03em]', tone === 'dark' ? 'text-white' : 'text-ink')}>
        Flyrlink
      </span>
    </span>
  );
}
