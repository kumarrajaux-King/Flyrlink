'use client';

import { Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PREVIEW_NOTICE_EVENT } from './preview-events';

const VISIBLE_MS = 4_500;

/** Polite, non-blocking notice for preview-only actions. */
export function PreviewToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onNotice = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), VISIBLE_MS);
    };
    window.addEventListener(PREVIEW_NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(PREVIEW_NOTICE_EVENT, onNotice);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4"
    >
      {message ? (
        <div className="pointer-events-auto flex max-w-md animate-rise items-start gap-3 rounded-2xl bg-navy-800 py-3 pr-3 pl-4 text-sm text-white/90 shadow-elevated ring-1 ring-white/10">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-300" />
          <p className="leading-relaxed">{message}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="-mt-0.5 grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
