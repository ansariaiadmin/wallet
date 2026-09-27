/**
 * Network ids the API accepts, mapped onto the P3 connectors.
 *
 * The facade is keyed by network id (`ethereum`, `solana`, …) while the
 * connectors are keyed by chain id plus a mainnet/testnet flag, so this table
 * is the single place that translates between the two.
 */

import type { ChainFamily, ChainId } from '@wallet/chains';

/** Every network the API can address. Testnets are distinct ids. */
export type NetworkId =
  | 'ethereum'
  | 'polygon'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'bsc'
  | 'solana'
  | 'solana-devnet'
  | 'tron'
  | 'tron-nile'
  | 'tron-shasta';

/** Every network the API knows, in a stable order. */
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

/** Chain id handed to the P3 connector for each network. */
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

/** True when `value` is a network id the API knows. */
export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === 'string' && NETWORK_IDS.includes(value as NetworkId);
}

/** The `network` flag a connector is created with. */
export function networkFlag(network: NetworkId): 'mainnet' | 'testnet' {
  return NETWORK_IS_TESTNET[network] ? 'testnet' : 'mainnet';
}
