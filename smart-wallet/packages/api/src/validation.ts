/**
 * Input guards shared by every route.
 *
 * Pure functions with no dependency beyond the language: each one narrows an
 * `unknown` (parsed JSON, path parameter) into the shape a handler needs and
 * leaves the error reporting to the caller.
 */

/** True when `v` is a string with at least one non-whitespace character. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * True when `v` is a positive integer written in canonical decimal form.
 *
 * Amounts cross the wire as strings because they are integers in the smallest
 * unit of a token (wei, lamport, sun) and must not lose precision on the way
 * through a float. Signs, exponents and fractional parts are therefore
 * rejected: `'0'`, `'-1'`, `'1.5'` and `'abc'` are all invalid.
 */
export function isPositiveNumberString(v: unknown): v is string {
  if (typeof v !== 'string') {
    return false;
  }
  const digits = v.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(digits)) {
    return false;
  }
  return BigInt(digits) > 0n;
}

/** True when `v` selects a supported transaction family. */
export function isChainType(v: unknown): v is 'evm' | 'solana' | 'tron' {
  return v === 'evm' || v === 'solana' || v === 'tron';
}

/** True when `v` selects a supported transfer kind. */
export function isTxType(v: unknown): v is 'native' | 'token' {
  return v === 'native' || v === 'token';
}

/** True when `v` is an integer in `[0, 255]`, the token decimals range. */
export function isDecimals(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
}
