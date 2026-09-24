'use client';

/**
 * Subtle scroll reveal.
 *
 * Content is visible by default, so nothing is hidden without JavaScript or
 * from above the fold. Only elements that start below the viewport are
 * hidden on mount and faded in as they arrive. Reduced motion skips it entirely.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/ui/cn';

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static');

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    setState('hidden');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState('shown');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={state === 'shown' && delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        state !== 'static' && 'transition-[opacity,translate] duration-700 ease-soft',
        state === 'hidden' && 'translate-y-5 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
