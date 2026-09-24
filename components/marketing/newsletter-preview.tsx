'use client';

import { type FormEvent, useId, useState } from 'react';

import { Button } from '../ui/button';
import { PREVIEW_MESSAGES, announcePreview } from './preview-events';

/**
 * The Figma "Stay in the loop" field. In this preview it is deliberately inert:
 * submitting clears the field and says nothing was stored. No address is sent
 * anywhere.
 */
export function NewsletterPreview() {
  const [email, setEmail] = useState('');
  const inputId = useId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmail('');
    announcePreview(PREVIEW_MESSAGES.newsletter);
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md items-center gap-2 rounded-full bg-white/5 p-1.5 ring-1 ring-white/10 focus-within:ring-accent-400/60">
      <label htmlFor={inputId} className="sr-only">
        Email address
      </label>
      <input
        id={inputId}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        autoComplete="off"
        className="h-10 min-w-0 flex-1 bg-transparent px-4 text-sm text-white placeholder:text-white/40 focus:outline-none"
      />
      <Button type="submit" size="sm" className="bg-accent-500 shadow-none hover:bg-accent-400">
        Subscribe
      </Button>
    </form>
  );
}
