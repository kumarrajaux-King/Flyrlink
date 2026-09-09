/**
 * Money — the single, centralized representation of monetary value (T-03).
 *
 * RULES (approved in STEP 02, confirmed at STEP 03 sign-off):
 *   - Amounts are integer MINOR units held in `bigint`. Never `number`, never float.
 *   - Every amount carries an explicit ISO-4217 currency.
 *   - Mixed-currency arithmetic throws rather than silently coercing.
 *   - Precision is preserved end to end: payment, commission, refund,
 *     transaction and payout all use these primitives.
 *
 * Values map directly onto the database convention `*Minor BIGINT` + `currency CHAR(3)`.
 */

export type CurrencyCode = string;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/**
 * ISO-4217 minor-unit exponents that differ from the default of 2.
 * Extend as currencies are enabled; the default covers most of the world.
 */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

const DEFAULT_MINOR_UNIT_EXPONENT = 2;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export class CurrencyMismatchError extends MoneyError {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(`Currency mismatch: cannot combine ${left} with ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency] ?? DEFAULT_MINOR_UNIT_EXPONENT;
}

function assertValidCurrency(currency: CurrencyCode): void {
  if (!ISO_4217_PATTERN.test(currency)) {
    throw new MoneyError(`Invalid ISO-4217 currency code: "${currency}"`);
  }
}

/** Construct a Money value from minor units. */
export function money(amountMinor: bigint | number, currency: CurrencyCode): Money {
  assertValidCurrency(currency);
  if (typeof amountMinor === 'number') {
    if (!Number.isInteger(amountMinor)) {
      throw new MoneyError(
        `Monetary amounts must be integer minor units; received ${amountMinor}. ` +
          'Fractional values indicate a float leaked into a money path.',
      );
    }
    return { amountMinor: BigInt(amountMinor), currency };
  }
  return { amountMinor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return money(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function negate(a: Money): Money {
  return { amountMinor: -a.amountMinor, currency: a.currency };
}

export function sum(values: readonly Money[], currency: CurrencyCode): Money {
  return values.reduce<Money>((acc, value) => add(acc, value), zero(currency));
}

/** Multiply by a whole number of units (e.g. hours worked, quantity). */
export function multiply(a: Money, factor: bigint | number): Money {
  const f = typeof factor === 'number' ? BigInt(assertInteger(factor, 'factor')) : factor;
  return { amountMinor: a.amountMinor * f, currency: a.currency };
}

function assertInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer; received ${value}`);
  }
  return value;
}

/**
 * Apply a rate expressed in basis points (1 bp = 0.01%; 1000 bp = 10%).
 *
 * Commission rates are stored as integer basis points precisely so this
 * calculation never touches a float. Rounding is half-up on the absolute
 * value, so the sign of the amount does not change the magnitude of rounding.
 */
export function applyBasisPoints(a: Money, basisPoints: number | bigint): Money {
  const bp = typeof basisPoints === 'number' ? BigInt(assertInteger(basisPoints, 'basisPoints')) : basisPoints;
  const scale = 10_000n;
  const negative = a.amountMinor < 0n;
  const magnitude = negative ? -a.amountMinor : a.amountMinor;

  const product = magnitude * bp;
  const quotient = product / scale;
  const remainder = product % scale;
  // Half-up: round away from zero when the remainder is >= half a unit.
  const rounded = remainder * 2n >= scale ? quotient + 1n : quotient;

  return { amountMinor: negative ? -rounded : rounded, currency: a.currency };
}

/**
 * Split an amount into parts by integer weights, distributing the rounding
 * remainder by the largest-remainder method.
 *
 * The parts are guaranteed to sum EXACTLY back to the input — no money is
 * created or destroyed by a split. Used wherever a payment is divided across
 * a team, milestones, or a partial refund.
 */
export function allocate(a: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('allocate requires at least one weight');
  }
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new MoneyError('allocate weights must be non-negative integers');
  }

  const totalWeight = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (totalWeight === 0n) {
    throw new MoneyError('allocate weights must not sum to zero');
  }

  const negative = a.amountMinor < 0n;
  const magnitude = negative ? -a.amountMinor : a.amountMinor;

  const bases: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  weights.forEach((weight, index) => {
    const product = magnitude * BigInt(weight);
    const base = product / totalWeight;
    bases.push(base);
    remainders.push({ index, remainder: product % totalWeight });
    distributed += base;
  });

  let leftover = magnitude - distributed;
  // Largest remainder first; ties broken by original order for determinism.
  remainders.sort((x, y) => (y.remainder === x.remainder ? x.index - y.index : y.remainder > x.remainder ? 1 : -1));

  for (const entry of remainders) {
    if (leftover <= 0n) break;
    bases[entry.index] = (bases[entry.index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return bases.map((base) => ({
    amountMinor: negative ? -base : base,
    currency: a.currency,
  }));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function isNegative(a: Money): boolean {
  return a.amountMinor < 0n;
}

export function isPositive(a: Money): boolean {
  return a.amountMinor > 0n;
}

/**
 * Parse a decimal string ("1250.50") into minor units. String input only —
 * accepting a float here would reintroduce exactly the precision loss this
 * module exists to prevent.
 */
export function fromDecimalString(value: string, currency: CurrencyCode): Money {
  assertValidCurrency(currency);
  const trimmed = value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Invalid decimal amount: "${value}"`);
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const exponent = minorUnitExponent(currency);

  if (fraction.length > exponent) {
    throw new MoneyError(
      `Amount "${value}" has more precision than ${currency} supports (${exponent} minor digits)`,
    );
  }

  const paddedFraction = fraction.padEnd(exponent, '0');
  const combined = `${whole}${paddedFraction}`;
  const amountMinor = BigInt(combined);

  return { amountMinor: sign === '-' ? -amountMinor : amountMinor, currency };
}

/** Render minor units as a plain decimal string. No locale formatting. */
export function toDecimalString(a: Money): string {
  const exponent = minorUnitExponent(a.currency);
  const negative = a.amountMinor < 0n;
  const magnitude = (negative ? -a.amountMinor : a.amountMinor).toString();

  if (exponent === 0) {
    return `${negative ? '-' : ''}${magnitude}`;
  }

  const padded = magnitude.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Locale-aware display string. Presentation only — never used for arithmetic. */
export function format(a: Money, locale = 'en-US'): string {
  const exponent = minorUnitExponent(a.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(toDecimalString(a)));
}
