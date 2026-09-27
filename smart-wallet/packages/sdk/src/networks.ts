import { pathFor } from '@wallet/keys';
import type { ChainId } from '@wallet/chains';
import type { ChainFamily, NetworkId } from './types';

/** Every network the SDK knows, in a stable order. */
export const NETWORK_IDS: readonly NetworkId[] = [
  'ethereum',
  'polygon',
  'base',
  'arbitrum',
  'optimism',
  'bsc',
  'solana',
  'solana-devnet',
  'tron',
  'tron-nile',
  'tron-shasta',
];

/** Chain family that serves each network. */
export const NETWORK_FAMILY: Readonly<Record<NetworkId, ChainFamily>> = {
  ethereum: 'evm',
  polygon: 'evm',
  base: 'evm',
  arbitrum: 'evm',
  optimism: 'evm',
  bsc: 'evm',
  solana: 'solana',
  'solana-devnet': 'solana',
  tron: 'tron',
  'tron-nile': 'tron',
  'tron-shasta': 'tron',
};

/** Chain id handed to the P3 connector and the P4 builder. */
export const NETWORK_CHAIN_ID: Readonly<Record<NetworkId, ChainId>> = {
  ethereum: 'ethereum',
  polygon: 'polygon',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  bsc: 'bsc',
  solana: 'solana',
  'solana-devnet': 'solana',
  tron: 'tron',
  'tron-nile': 'tron',
  'tron-shasta': 'tron',
};

/** Whether a network is a testnet of its chain. */
export const NETWORK_IS_TESTNET: Readonly<Record<NetworkId, boolean>> = {
  ethereum: false,
  polygon: false,
  base: false,
  arbitrum: false,
  optimism: false,
  bsc: false,
  solana: false,
  'solana-devnet': true,
  tron: false,
  'tron-nile': true,
  'tron-shasta': true,
};

/**
 * Default BIP-44 derivation path per family.
 *
 * The values come from `@wallet/keys` so the repo carries one definition of a
 * default path: what the sdk derives with `deriveKey` is byte-identical to what
 * `deriveEvm`/`deriveSolana`/`deriveTron` derive from a mnemonic.
 */
export const FAMILY_DERIVATION_PATH: Readonly<Record<ChainFamily, string>> = {
  evm: pathFor('evm'),
  solana: pathFor('solana'),
  tron: pathFor('tron'),
};

/** True when `value` is a network id the SDK knows. */
export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === 'string' && NETWORK_IDS.includes(value as NetworkId);
}
