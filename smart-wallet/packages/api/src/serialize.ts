/**
 * JSON conversion for values that carry types `JSON.stringify` cannot handle.
 *
 * The builder returns `Uint8Array` payloads and `bigint` amounts (fees, nonces,
 * gas limits); sending those straight through `c.json()` would throw. This
 * helper walks the value and rewrites:
 *
 * - `bigint` → decimal string (no precision loss, unlike a number)
 * - `Uint8Array` → `0x`-prefixed hex
 *
 * Everything else is passed through untouched.
 */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString('hex')}`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => jsonSafe(entry));
  }
  if (typeof value === 'object' && value !== null) {
    const plain: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      plain[key] = jsonSafe(entry);
    }
    return plain;
  }
  return value;
}
