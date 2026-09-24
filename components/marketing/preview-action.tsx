'use client';

import { Button, type ButtonProps } from '../ui/button';
import { announcePreview } from './preview-events';

/**
 * A button for an action that belongs to a later phase. It says so, instead of
 * linking to a screen that does not exist or pretending to succeed.
 */
export function PreviewActionButton({ message, ...props }: ButtonProps & { readonly message: string }) {
  return <Button {...props} onClick={() => announcePreview(message)} />;
}
