/**
 * Form primitives.
 *
 * Every control gets a real `<label>`, a stable id, and a place for the error
 * the server returned. The API answers a failed validation with
 * `{ error: { code, message, details } }` where `details` is keyed by field
 * name (STEP 02 §8), so a form can put each message next to the input that
 * caused it instead of showing one banner for everything.
 *
 * Errors are bound with `aria-describedby` and marked `aria-invalid`, so the
 * message reaches a screen reader rather than only being visible.
 */

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

import { cn } from '../../lib/ui/cn';

const CONTROL = [
  'w-full rounded-xl bg-white px-4 py-3 text-[15px] text-ink',
  'ring-1 ring-line ring-inset transition-[box-shadow,ring-color] duration-200',
  'placeholder:text-ink-subtle',
  'focus:ring-2 focus:ring-brand-400 focus:outline-none',
  'aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-400',
  'disabled:cursor-not-allowed disabled:bg-canvas-subtle disabled:text-ink-subtle',
].join(' ');

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function TextInput({ className, invalid, ...props }: TextInputProps) {
  return <input aria-invalid={invalid || undefined} className={cn(CONTROL, className)} {...props} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export function TextArea({ className, invalid, ...props }: TextAreaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'resize-y leading-relaxed', className)}
      {...props}
    />
  );
}

/** A refusal that belongs to the whole form rather than one field. */
export function FormError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl bg-red-50 px-4 py-3 text-[13px] leading-relaxed font-medium text-red-700 ring-1 ring-red-200 ring-inset"
    >
      {message}
    </p>
  );
}
