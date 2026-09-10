import { describe, expect, it } from 'vitest';

import {
  CurrencyMismatchError,
  MoneyError,
  add,
  allocate,
  applyBasisPoints,
  compare,
  equals,
  format,
  fromDecimalString,
  isNegative,
  isZero,
  money,
  multiply,
  negate,
  subtract,
  sum,
  toDecimalString,
  zero,
} from '../../domain/money/money';

describe('Money — construction and validation', () => {
  it('constructs from bigint and number minor units', () => {
    expect(money(125050n, 'INR').amountMinor).toBe(125050n);
    expect(money(10025, 'USD').amountMinor).toBe(10025n);
  });

  it('rejects fractional numbers — a float in a money path is a bug', () => {
    expect(() => money(100.5, 'USD')).toThrow(MoneyError);
  });

  it('rejects malformed currency codes', () => {
    expect(() => money(100n, 'us')).toThrow(MoneyError);
    expect(() => money(100n, 'DOLLAR')).toThrow(MoneyError);
  });
});

describe('Money — arithmetic', () => {
  it('adds and subtracts without precision loss', () => {
    const a = money(125050n, 'INR'); // ₹1,250.50
    const b = money(74950n, 'INR'); //  ₹749.50
    expect(add(a, b).amountMinor).toBe(200000n); // ₹2,000.00
    expect(subtract(a, b).amountMinor).toBe(50100n); // ₹501.00
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100n, 'INR'), money(100n, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100n, 'INR'), money(100n, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(100n, 'INR'), money(100n, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('sums a collection', () => {
    const values = [money(100n, 'USD'), money(250n, 'USD'), money(1n, 'USD')];
    expect(sum(values, 'USD').amountMinor).toBe(351n);
    expect(sum([], 'USD')).toEqual(zero('USD'));
  });

  it('multiplies by whole units', () => {
    expect(multiply(money(5000n, 'USD'), 8).amountMinor).toBe(40000n);
  });

  it('handles very large amounts that would break a float', () => {
    // 2^53 + 1 minor units — not representable exactly as a JS number.
    const huge = money(9007199254740993n, 'USD');
    expect(add(huge, money(1n, 'USD')).amountMinor).toBe(9007199254740994n);
  });
});

describe('Money — basis points (commission, tax, fees)', () => {
  it('computes a 10% platform commission exactly', () => {
    // Master spec §20 worked example: ₹100,000 → ₹10,000 commission, ₹90,000 payable.
    const gross = money(10_000_000n, 'INR'); // ₹100,000.00
    const commission = applyBasisPoints(gross, 1000); // 10.00%
    expect(commission.amountMinor).toBe(1_000_000n); // ₹10,000.00
    expect(subtract(gross, commission).amountMinor).toBe(9_000_000n); // ₹90,000.00
  });

  it('rounds half-up on the absolute value', () => {
    // 1234 minor * 250bp = 30.85 → 31
    expect(applyBasisPoints(money(1234n, 'USD'), 250).amountMinor).toBe(31n);
    // Exactly half rounds away from zero, symmetrically for negatives.
    expect(applyBasisPoints(money(200n, 'USD'), 25).amountMinor).toBe(1n);
    expect(applyBasisPoints(money(-200n, 'USD'), 25).amountMinor).toBe(-1n);
  });

  it('is exact at 0% and 100%', () => {
    const gross = money(123_456n, 'USD');
    expect(applyBasisPoints(gross, 0).amountMinor).toBe(0n);
    expect(applyBasisPoints(gross, 10_000).amountMinor).toBe(123_456n);
  });

  it('rejects fractional basis points', () => {
    expect(() => applyBasisPoints(money(100n, 'USD'), 12.5)).toThrow(MoneyError);
  });
});

describe('Money — allocation', () => {
  it('splits without creating or destroying money', () => {
    // 100 minor units across three equal parts cannot divide evenly.
    const parts = allocate(money(100n, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(100n);
  });

  it('respects weights', () => {
    const parts = allocate(money(10_000n, 'INR'), [70, 30]);
    expect(parts.map((p) => p.amountMinor)).toEqual([7000n, 3000n]);
  });

  it('conserves value for awkward splits', () => {
    const total = money(999_999n, 'INR');
    const parts = allocate(total, [3, 5, 7, 11]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(999_999n);
  });

  it('conserves value for negative amounts (reversals)', () => {
    const parts = allocate(money(-100n, 'USD'), [1, 1, 1]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(-100n);
  });

  it('rejects invalid weights', () => {
    expect(() => allocate(money(100n, 'USD'), [])).toThrow(MoneyError);
    expect(() => allocate(money(100n, 'USD'), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(money(100n, 'USD'), [-1, 2])).toThrow(MoneyError);
  });
});

describe('Money — parsing and rendering', () => {
  it('round-trips decimal strings', () => {
    expect(fromDecimalString('1250.50', 'INR').amountMinor).toBe(125050n);
    expect(fromDecimalString('100.25', 'USD').amountMinor).toBe(10025n);
    expect(fromDecimalString('-42.07', 'USD').amountMinor).toBe(-4207n);
    expect(toDecimalString(money(125050n, 'INR'))).toBe('1250.50');
    expect(toDecimalString(money(-4207n, 'USD'))).toBe('-42.07');
    expect(toDecimalString(money(5n, 'USD'))).toBe('0.05');
  });

  it('honours currencies with non-default minor units', () => {
    expect(fromDecimalString('1000', 'JPY').amountMinor).toBe(1000n); // 0 decimals
    expect(toDecimalString(money(1000n, 'JPY'))).toBe('1000');
    expect(fromDecimalString('1.500', 'KWD').amountMinor).toBe(1500n); // 3 decimals
    expect(toDecimalString(money(1500n, 'KWD'))).toBe('1.500');
  });

  it('rejects amounts with more precision than the currency allows', () => {
    expect(() => fromDecimalString('1.005', 'USD')).toThrow(MoneyError);
    expect(() => fromDecimalString('10.5', 'JPY')).toThrow(MoneyError);
  });

  it('rejects malformed input', () => {
    expect(() => fromDecimalString('abc', 'USD')).toThrow(MoneyError);
    expect(() => fromDecimalString('1,250.50', 'USD')).toThrow(MoneyError);
    expect(() => fromDecimalString('', 'USD')).toThrow(MoneyError);
  });

  it('formats for display', () => {
    expect(format(money(125050n, 'USD'))).toContain('1,250.50');
  });
});

describe('Money — predicates', () => {
  it('reports sign and equality', () => {
    expect(isZero(zero('USD'))).toBe(true);
    expect(isNegative(money(-1n, 'USD'))).toBe(true);
    expect(equals(money(100n, 'USD'), money(100n, 'USD'))).toBe(true);
    expect(equals(money(100n, 'USD'), money(100n, 'INR'))).toBe(false);
    expect(negate(money(100n, 'USD')).amountMinor).toBe(-100n);
  });
});
