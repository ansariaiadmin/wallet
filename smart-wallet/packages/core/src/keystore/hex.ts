/** Hex-encoded bytes: lowercase, `0x`-prefixed. */
export type Hex = `0x${string}`;

const HEX_PATTERN = /^0x(?:[0-9a-f]{2})*$/;

/** Encodes bytes as a `0x`-prefixed lowercase hex string. */
export function toHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex as Hex;
}

/** Decodes a `0x`-prefixed hex string back to bytes. */
export function fromHex(hex: Hex): Uint8Array {
  if (!HEX_PATTERN.test(hex)) {
    throw new TypeError('Invalid hex string: expected 0x-prefixed, even-length lowercase hex');
  }
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}
