import { UnsupportedPathError } from './errors';

/** Chains the keystore can derive addresses for. */
export type Chain = 'evm' | 'tron' | 'solana';

/** BIP-44 purpose and SLIP-44 coin types with a supported address scheme. */
export const BIP44_PURPOSE = 44;
export const COIN_TYPES: Readonly<Record<number, Chain>> = {
  60: 'evm',
  195: 'tron',
  501: 'solana',
};

export const HARDENED_OFFSET = 0x80000000;

/** Default derivation paths per chain. */
export const DEFAULT_EVM_PATH = "m/44'/60'/0'/0/0";
export const DEFAULT_TRON_PATH = "m/44'/195'/0'/0/0";
export const DEFAULT_SOLANA_PATH = "m/44'/501'/0'/0'";

/** A validated BIP-44 derivation path. */
export interface ParsedPath {
  /** Absolute indices (hardened values include {@link HARDENED_OFFSET}). */
  readonly indices: readonly number[];
  /** Whether each segment was written hardened, per segment. */
  readonly hardened: readonly boolean[];
  /** SLIP-44 coin type without the hardened bit. */
  readonly coinType: number;
  /** Chain implied by the coin type. */
  readonly chain: Chain;
}

/** Parses and validates a BIP-44 path such as `m/44'/60'/0'/0/0`. */
export function parseDerivationPath(path: string): ParsedPath {
  if (typeof path !== 'string') {
    throw new UnsupportedPathError(String(path), 'path must be a string');
  }

  const segments = path.split('/');
  if (segments[0] !== 'm' || segments.length < 3) {
    throw new UnsupportedPathError(path, "expected a path like m/44'/60'/0'/0/0");
  }

  const indices: number[] = [];
  const hardened: boolean[] = [];
  for (const segment of segments.slice(1)) {
    const isHardened = /['hH]$/.test(segment);
    const digits = isHardened ? segment.slice(0, -1) : segment;
    if (!/^\d+$/.test(digits)) {
      throw new UnsupportedPathError(path, `segment "${segment}" is not an index`);
    }
    const value = Number.parseInt(digits, 10);
    if (value >= HARDENED_OFFSET) {
      throw new UnsupportedPathError(path, `segment "${segment}" is out of range`);
    }
    indices.push(isHardened ? value + HARDENED_OFFSET : value);
    hardened.push(isHardened);
  }

  if (indices.length !== 5 && indices.length !== 4) {
    throw new UnsupportedPathError(
      path,
      "expected 4 or 5 segments (m/44'/coin'/account'[/change]/index)",
    );
  }

  const [purpose, coin, account] = indices;
  if (purpose !== BIP44_PURPOSE + HARDENED_OFFSET) {
    throw new UnsupportedPathError(path, "first segment must be 44' (BIP-44)");
  }
  if (coin === undefined || coin < HARDENED_OFFSET) {
    throw new UnsupportedPathError(path, "coin type segment must be hardened (e.g. 60')");
  }
  if (account === undefined || account < HARDENED_OFFSET) {
    throw new UnsupportedPathError(path, "account segment must be hardened (e.g. 0')");
  }

  const coinType = coin - HARDENED_OFFSET;
  const chain = COIN_TYPES[coinType];
  if (chain === undefined) {
    throw new UnsupportedPathError(
      path,
      `no address scheme for coin type ${coinType} (supported: 60 EVM, 195 TRON, 501 Solana)`,
    );
  }

  return { indices, hardened, coinType, chain };
}
