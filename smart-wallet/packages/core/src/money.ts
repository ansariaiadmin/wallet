import { CurrencyMismatchError } from './errors';

/** ISO-4217-style currency code, e.g. `IRT` or `USD`. */
export type CurrencyCode = string;

/** An amount of money held in its minor unit (e.g. cents) as a bigint. */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

/** Creates a {@link Money} value from a minor-unit amount. */
export function money(amountMinor: bigint | number, currency: CurrencyCode = 'IRT'): Money {
  return { amountMinor: BigInt(amountMinor), currency };
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new CurrencyMismatchError(left.currency, right.currency);
  }
}

/** Adds two amounts, requiring the same currency. */
export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { amountMinor: left.amountMinor + right.amountMinor, currency: left.currency };
}

/** Subtracts `right` from `left`, requiring the same currency. */
export function subtract(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { amountMinor: left.amountMinor - right.amountMinor, currency: left.currency };
}

/** Orders two amounts: `-1`, `0` or `1`. */
export function compare(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amountMinor < right.amountMinor) return -1;
  if (left.amountMinor > right.amountMinor) return 1;
  return 0;
}

/** True when the amount is below zero. */
export function isNegative(value: Money): boolean {
  return value.amountMinor < 0n;
}

/** True when the amount is exactly zero. */
export function isZero(value: Money): boolean {
  return value.amountMinor === 0n;
}
