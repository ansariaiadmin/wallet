import { describe, expect, it } from 'vitest';
import { add, compare, isNegative, isZero, money, subtract } from '@core/money';
import { CurrencyMismatchError } from '@core/errors';

describe('money', () => {
  it('adds amounts in the same currency', () => {
    expect(add(money(100n), money(250n))).toEqual({ amountMinor: 350n, currency: 'IRT' });
  });

  it('subtracts without losing precision', () => {
    expect(subtract(money(500n), money(200n)).amountMinor).toBe(300n);
  });

  it('rejects operations across currencies', () => {
    expect(() => add(money(1n, 'IRT'), money(1n, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('orders amounts', () => {
    expect(compare(money(1n), money(2n))).toBe(-1);
    expect(compare(money(2n), money(2n))).toBe(0);
    expect(compare(money(3n), money(2n))).toBe(1);
  });

  it('flags negative and zero amounts', () => {
    expect(isNegative(money(-1n))).toBe(true);
    expect(isNegative(money(0n))).toBe(false);
    expect(isZero(money(0n))).toBe(true);
    expect(isZero(money(1n))).toBe(false);
  });
});
