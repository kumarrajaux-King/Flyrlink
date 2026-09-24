/**
 * Buttons.
 *
 * Pill-shaped, following the Figma CTAs: the blue primary ("Sign up"), the dark
 * navy pill with an arrow ("Find an expert →"), and the white pill used on blue
 * bands ("Browse all experts"). One variant table serves both `<button>` and
 * `<a>`, so a link styled as a button can never drift from a real one.
 */

import { type VariantProps, cva } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

import { cn } from '../../lib/ui/cn';

export const buttonVariants = cva(
  [
    'group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full',
    'font-semibold tracking-[-0.01em] select-none',
    'transition-[background-color,box-shadow,color,transform,translate] duration-300 ease-soft',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-55',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand-500 text-white shadow-brand hover:-translate-y-0.5 hover:bg-brand-600',
        dark: 'bg-navy-800 text-white shadow-[0_14px_30px_-16px_rgb(8_37_62/0.8)] hover:-translate-y-0.5 hover:bg-navy-900',
        secondary:
          'bg-white text-ink shadow-[0_1px_2px_rgb(12_39_56/0.06)] ring-1 ring-line-strong ring-inset hover:-translate-y-0.5 hover:text-brand-600 hover:ring-brand-300',
        ghost: 'text-ink-muted hover:bg-canvas-subtle hover:text-ink',
        light: 'bg-white text-navy-800 shadow-[0_16px_34px_-18px_rgb(8_37_62/0.7)] hover:-translate-y-0.5 hover:bg-brand-50',
        glass: 'surface-glass text-white hover:bg-white/20',
      },
      size: {
        sm: 'h-9 px-4 text-[13px]',
        md: 'h-11 px-5 text-sm',
        lg: 'h-13 px-6 text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonVariantProps {}

export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** The circular arrow that ends the Figma dark pill. Moves on hover of its button. */
export function ButtonArrow({ tone = 'light' }: { readonly tone?: 'light' | 'dark' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        '-mr-2 grid size-7 place-items-center rounded-full transition-transform duration-300 ease-soft group-hover/button:translate-x-0.5',
        tone === 'light' ? 'bg-white/15' : 'bg-navy-800/8',
      )}
    >
      <ArrowRight className="size-3.5" strokeWidth={2.25} />
    </span>
  );
}
