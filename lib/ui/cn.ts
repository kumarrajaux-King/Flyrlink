/**
 * Class-name composition for UI components.
 *
 * `clsx` handles conditionals; `tailwind-merge` resolves conflicting Tailwind
 * utilities so a caller's `className` reliably overrides a component default
 * (e.g. `px-6` over `px-4`) instead of depending on stylesheet order.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
