/**
 * Money rendering (A-04: one place renders money).
 *
 * Amounts arrive as minor-unit strings (BigInt does not cross the server/client
 * boundary) and are scaled by the currency's real exponent from `domain/money`,
 * never by an assumed 100. Display only — no arithmetic happens here.
 */

import { minorUnitExponent } from '../../domain/money/money';

function toMajor(minor: string | bigint, currency: string): number {
  return Number(BigInt(minor)) / 10 ** minorUnitExponent(currency);
}

export function formatMinor(minor: string | bigint, currency: string, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    toMajor(minor, currency),
  );
}

/** Compact form for advisory ranges, e.g. ₹7L. */
export function formatMinorCompact(minor: string | bigint | number, currency: string, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toMajor(typeof minor === 'number' ? BigInt(minor) : minor, currency));
}

export function MoneyAmount({
  minor,
  currency,
  suffix,
  className,
}: {
  readonly minor: string;
  readonly currency: string;
  readonly suffix?: string;
  readonly className?: string;
}) {
  return (
    <span className={className}>
      <span className="font-semibold text-ink tabular-nums">{formatMinor(minor, currency)}</span>
      {suffix ? <span className="text-ink-subtle">{suffix}</span> : null}
    </span>
  );
}
