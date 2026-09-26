/** Formats a minor-unit amount with exact BigInt math (no float rounding). */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

/** Parses a decimal string into minor units, throwing on bad input. */
export function parseUnits(value: string, decimals: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) {
    throw new RangeError(`invalid decimal amount: ${value}`);
  }
  const [, sign = '', whole = '', fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new RangeError(`amount ${value} has more than ${decimals} decimals`);
  }
  const padded = fraction.padEnd(decimals, '0');
  const amount = BigInt(`${whole}${padded}`);
  return sign === '-' ? -amount : amount;
}
