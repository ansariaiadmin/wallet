/**
 * Chain name to family mapping used by the quote and build routes.
 *
 * The wallet core is keyed by family (`evm`, `solana`, `tron`) while callers
 * think in chain names, so this table is the single place that translates
 * between the two.
 */

import type { SwapFamily } from '@wallet/router';

/** Chain names the API accepts, mapped onto the family that serves them. */
export const CHAIN_TO_FAMILY: Readonly<Record<string, SwapFamily>> = {
  ethereum: 'evm',
  mainnet: 'evm',
  polygon: 'evm',
  matic: 'evm',
  base: 'evm',
  arbitrum: 'evm',
  optimism: 'evm',
  bsc: 'evm',
  'bnb-smart-chain': 'evm',
  sepolia: 'evm',
  'base-sepolia': 'evm',
  'arbitrum-sepolia': 'evm',
  'optimism-sepolia': 'evm',
  amoy: 'evm',
  'bsc-testnet': 'evm',
  solana: 'solana',
  'solana-devnet': 'solana',
  'solana-testnet': 'solana',
  tron: 'tron',
  nile: 'tron',
  shasta: 'tron',
};

/** Canonical chain id handed to the P4 builder for each family. */
export const FAMILY_CHAIN_ID: Readonly<Record<SwapFamily, string>> = {
  evm: 'ethereum',
  solana: 'solana',
  tron: 'tron',
};

/** Numeric EIP-155 chain ids, forwarded to the router for EVM quotes. */
export const EVM_CHAIN_IDS: Readonly<Record<string, number>> = {
  ethereum: 1,
  mainnet: 1,
  polygon: 137,
  matic: 137,
  base: 8453,
  arbitrum: 42_161,
  optimism: 10,
  bsc: 56,
  'bnb-smart-chain': 56,
  sepolia: 11_155_111,
  'base-sepolia': 84_532,
  'arbitrum-sepolia': 421_614,
  'optimism-sepolia': 11_155_420,
  amoy: 80_002,
  'bsc-testnet': 97,
};

/** Resolves a chain name to its family, or `undefined` when unknown. */
export function familyOf(chain: string): SwapFamily | undefined {
  return CHAIN_TO_FAMILY[chain.trim().toLowerCase()];
}
