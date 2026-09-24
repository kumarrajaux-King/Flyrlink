import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/ui/cn';

/** The Figma content width: 1280px inside the 1440px frame. */
export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-10', className)} {...props} />;
}
