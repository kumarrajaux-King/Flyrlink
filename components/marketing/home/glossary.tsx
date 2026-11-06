'use client';

/**
 * The six landing-copy terms, bound to their single definition.
 *
 * Wrapping `Tooltip` here rather than passing strings at each call site means a
 * definition is written once (`TOOLTIPS` in `content.ts`) and cannot drift
 * between the escrow section and the pricing section.
 */

import { Tooltip } from '../../ui/tooltip';
import { TOOLTIPS, type TooltipTerm } from './content';

export function Term({ name, children }: { readonly name: TooltipTerm; readonly children: string }) {
  return <Tooltip term={children} definition={TOOLTIPS[name]} />;
}
