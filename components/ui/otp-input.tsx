'use client';

/**
 * A one-time-code field.
 *
 * WHY ONE INPUT AND NOT SIX BOXES
 *   Six separate boxes are the familiar look, and they are worse in every way
 *   that matters here. A screen reader announces six unlabelled fields instead
 *   of one labelled one; `autocomplete="one-time-code"` — which is what lets a
 *   phone or password manager offer the code — only works on a single field;
 *   and paste has to be reimplemented by hand, usually badly.
 *
 *   So this is one real `<input>`, styled to read as digits: monospace,
 *   generously tracked, centred. Paste, autofill, keyboard and voice input all
 *   work because nothing was taken away from them.
 *
 * WHAT IT DOES ADD
 *   Digits only while in `numeric` mode, stripped on input rather than refused
 *   on keypress — so pasting "123 456" or "code: 123456" yields `123456`
 *   instead of silently failing. `backup` mode accepts the Crockford-style
 *   alphanumeric backup codes instead, upper-cased as they are typed.
 */

import { forwardRef, useId } from 'react';

import { cn } from '../../lib/ui/cn';

export type OtpMode = 'numeric' | 'backup';

export interface OtpInputProps {
  readonly id?: string;
  readonly name: string;
  readonly mode?: OtpMode;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly describedBy?: string | undefined;
  readonly onChange?: (value: string) => void;
}

/** Everything that is not part of a code of this kind, removed. */
export function cleanOtp(raw: string, mode: OtpMode): string {
  return mode === 'numeric'
    ? raw.replace(/\D/g, '').slice(0, 6)
    : raw.replace(/[^0-9A-Za-z-]/g, '').toUpperCase().slice(0, 20);
}

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { id, name, mode = 'numeric', invalid, disabled, autoFocus, describedBy, onChange },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const numeric = mode === 'numeric';

  return (
    <input
      ref={ref}
      id={inputId}
      name={name}
      type="text"
      // `one-time-code` is what makes a phone offer the code from an
      // authenticator or an SMS. It is meaningless for a backup code, which is
      // written down rather than generated, so it is not claimed there.
      autoComplete={numeric ? 'one-time-code' : 'off'}
      inputMode={numeric ? 'numeric' : 'text'}
      pattern={numeric ? '[0-9]*' : undefined}
      /*
       * Deliberately NOT 6.
       *
       * `maxLength` truncates the raw text *before* any handler sees it, so a
       * pasted "98 76 54" arrived as "98 76 " and cleaned down to "9876" — a
       * four-digit code, silently. The length that matters is the cleaned one,
       * and `cleanOtp` caps that; this is only a sanity bound on the paste.
       */
      maxLength={numeric ? 32 : 40}
      required
      autoFocus={autoFocus}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      placeholder={numeric ? '123456' : 'XXXX-XXXX'}
      // Normalised as it is typed, so a pasted "123 456" becomes a valid code
      // rather than a validation error the person has to decipher.
      onInput={(event) => {
        const input = event.currentTarget;
        const cleaned = cleanOtp(input.value, mode);
        // Assigning moves the caret to the end, which is where it belongs after
        // a paste and where it already was while typing.
        if (cleaned !== input.value) input.value = cleaned;
        onChange?.(cleaned);
      }}
      className={cn(
        'w-full rounded-xl bg-white py-4 text-center font-mono tabular-nums text-ink',
        'ring-1 ring-line ring-inset transition-[box-shadow,ring-color] duration-200',
        'placeholder:text-ink-subtle/70',
        'focus:ring-2 focus:ring-brand-400 focus:outline-none',
        'aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-400',
        'disabled:cursor-not-allowed disabled:bg-canvas-subtle disabled:text-ink-subtle',
        numeric ? 'text-2xl tracking-[0.5em] indent-[0.5em]' : 'text-lg tracking-[0.18em]',
      )}
    />
  );
});
