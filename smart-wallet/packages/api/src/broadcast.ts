/**
 * Wire-format helpers for the broadcast and status endpoints.
 *
 * A signed transaction crosses the API as a string, so it has to be translated
 * into whatever encoding the connector for that family expects before it is
 * handed over:
 *
 * - EVM (ethereum, polygon, base, arbitrum, optimism, bsc) — `0x`-prefixed hex
 * - Solana — base64 (or `0x` hex, both accepted by the connector decoder)
 * - TRON — the signed transaction *object* as a JSON string, because TronGrid
 *   broadcasts an object rather than raw bytes
 *
 * Every check here is local: nothing is sent anywhere, so a malformed payload
 * is a 400 rather than a connector failure.
 */

import { ApiError } from './errors';
import { NETWORK_FAMILY, type NetworkId } from './networks';

/** `0x`-prefixed hex with at least one digit. */
const HEX = /^0x[0-9a-fA-F]+$/;
/** Base64 with correct padding. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** 32-byte hash, checksummed or not. */
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
/** 32-byte hash without the `0x` prefix, as TRON reports it. */
const TRON_HASH = /^[0-9a-fA-F]{64}$/;
/** Base58, the encoding Solana signatures use. */
const SOLANA_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;

/**
 * Translates a signed transaction into the encoding `network`'s connector
 * expects.
 *
 * @throws ApiError 400 when the payload does not match the family's encoding.
 */
export function toBroadcastPayload(network: NetworkId, signedTx: string): string {
  const family = NETWORK_FAMILY[network];
  const trimmed = signedTx.trim();

  if (family === 'evm') {
    if (!HEX.test(trimmed)) {
      throw new ApiError(
        400,
        'INVALID_INPUT',
        `signedTx must be 0x-prefixed hex on ${network}, got ${describe(trimmed)}`,
      );
    }
    return trimmed;
  }

  if (family === 'solana') {
    if (HEX.test(trimmed) || BASE64.test(trimmed)) {
      return trimmed;
    }
    throw new ApiError(
      400,
      'INVALID_INPUT',
      `signedTx must be base64 or 0x-prefixed hex on ${network}`,
    );
  }

  return trimmed;
}

/** True when `txHash` has the shape `network` reports hashes in. */
export function isTxHash(network: NetworkId, txHash: string): boolean {
  const trimmed = txHash.trim();
  switch (NETWORK_FAMILY[network]) {
    case 'evm':
      return EVM_HASH.test(trimmed);
    case 'solana':
      return SOLANA_HASH.test(trimmed);
    default:
      return TRON_HASH.test(trimmed);
  }
}

/** Short, safe rendering of a payload for an error message. */
function describe(payload: string): string {
  return payload.length > 24 ? `${payload.slice(0, 24)}…` : payload;
}
