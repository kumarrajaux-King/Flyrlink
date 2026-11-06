'use client';

/**
 * A term with its definition attached.
 *
 * The landing copy (§7.3) defines six terms — escrow, milestone, match score,
 * verified, advisory estimate, inspection period — and every one of them is a
 * term a client could reasonably misread in a way that costs them money. So the
 * definition travels with the word rather than living in a glossary page nobody
 * opens.
 *
 * ACCESSIBILITY
 *   The trigger is a real `<button>`, so it is reachable by keyboard and
 *   announced as interactive. The definition is bound with `aria-describedby`,
 *   opens on hover *and* on focus, and closes on Escape, on blur, or on a tap
 *   elsewhere — a hover-only tooltip is invisible to a keyboard or a touch
 *   user, which for a definition of "escrow" is not an acceptable outcome.
 *
 *   A click always opens rather than toggling. On a pointer device the hover
 *   has already opened it, so a toggle would close the bubble the instant the
 *   user clicked the thing they were trying to read.
 *
 * STAYING INSIDE THE VIEWPORT
 *   The bubble is centred on its term, which pushes it off-screen when the term
 *   sits near an edge — and an absolutely positioned element hanging off the
 *   right edge widens the document and gives the whole page a horizontal
 *   scrollbar. At 390px that was a real defect, caught by a test that compares
 *   `scrollWidth` with the viewport. So the offset is measured once on open and
 *   clamped to an 8px gutter.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../../lib/ui/cn';

/** Minimum gap between the bubble and the edge of the viewport. */
const GUTTER = 8;

export function Tooltip({
  term,
  definition,
  className,
}: {
  readonly term: string;
  readonly definition: string;
  readonly className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const wrapper = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  const clamp = useCallback(() => {
    const node = bubble.current;
    if (!node) return;
    // Measure with the current offset removed, then work out what it should be.
    const rect = node.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const left = rect.left - offset;
    const right = rect.right - offset;

    const correction =
      left < GUTTER ? GUTTER - left : right > viewport - GUTTER ? viewport - GUTTER - right : 0;
    if (Math.round(correction) !== Math.round(offset)) setOffset(correction);
  }, [offset]);

  useLayoutEffect(() => {
    if (open) clamp();
  }, [open, clamp]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A tap elsewhere dismisses it, which is the only way to close it on touch.
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    // Resize only. The bubble is positioned against its own trigger, so it
    // travels with the page and a scroll cannot move it off target — closing on
    // scroll would just dismiss the definition as the reader scrolled to it.
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <span ref={wrapper} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-help rounded-sm underline decoration-brand-300 decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {term}
      </button>
      {/* Rendered only while open: a bubble that is merely transparent still
          occupies layout, and six of them hanging off the right edge is what
          widened the document in the first place. */}
      {open ? (
        <span
          ref={bubble}
          id={id}
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${Math.round(offset)}px))` }}
          className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-40 w-64 max-w-[calc(100vw-1rem)] animate-rise rounded-xl bg-navy-900 px-3.5 py-2.5 text-left text-[13px] leading-relaxed font-normal text-white shadow-[0_20px_40px_-20px_rgb(8_37_62/0.8)]"
        >
          {definition}
        </span>
      ) : null}
    </span>
  );
}
