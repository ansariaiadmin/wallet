import { UnsupportedChainError } from './errors';
import type { ChainDefinition, ChainId } from './types';

/**
 * Built-in chain registry. Endpoint lists are ordered by priority: the first
 * entry is the primary, the rest are fallbacks used by the retry policy.
 */
export const CHAINS: Readonly<Record<ChainId, ChainDefinition>> = {
  ethereum: {
    id: 'ethereum',
    family: 'evm',
    name: 'Ethereum',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://etherscan.io',
    testnetExplorerUrl: 'https://sepolia.etherscan.io',
    rpcUrls: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'],
    testnetRpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
      'https://ethereum-sepolia.publicnode.com',
    ],
  },
  polygon: {
    id: 'polygon',
    family: 'evm',
    name: 'Polygon',
    nativeCurrency: { symbol: 'POL', decimals: 18 },
    explorerUrl: 'https://polygonscan.com',
    testnetExplorerUrl: 'https://amoy.polygonscan.com',
    rpcUrls: ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
    testnetRpcUrls: ['https://rpc-amoy.polygon.technology', 'https://polygon-amoy.drpc.org'],
  },
  base: {
    id: 'base',
    family: 'evm',
    name: 'Base',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://basescan.org',
    testnetExplorerUrl: 'https://sepolia.basescan.org',
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    testnetRpcUrls: ['https://sepolia.base.org'],
  },
  arbitrum: {
    id: 'arbitrum',
    family: 'evm',
    name: 'Arbitrum One',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://arbiscan.io',
    testnetExplorerUrl: 'https://sepolia.arbiscan.io',
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
    testnetRpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
  },
  optimism: {
    id: 'optimism',
    family: 'evm',
    name: 'OP Mainnet',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://optimistic.etherscan.io',
    testnetExplorerUrl: 'https://sepolia-optimism.etherscan.io',
    rpcUrls: ['https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
    testnetRpcUrls: ['https://sepolia.optimism.io'],
  },
  bsc: {
    id: 'bsc',
    family: 'evm',
    name: 'BNB Smart Chain',
    nativeCurrency: { symbol: 'BNB', decimals: 18 },
    explorerUrl: 'https://bscscan.com',
    testnetExplorerUrl: 'https://testnet.bscscan.com',
    rpcUrls: ['https://bsc-dataseed.binance.org', 'https://rpc.ankr.com/bsc'],
    testnetRpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
  },
  solana: {
    id: 'solana',
    family: 'solana',
    name: 'Solana',
    nativeCurrency: { symbol: 'SOL', decimals: 9 },
    explorerUrl: 'https://solscan.io',
    testnetExplorerUrl: 'https://solscan.io?cluster=devnet',
    rpcUrls: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'],
    testnetRpcUrls: ['https://api.devnet.solana.com'],
  },
  tron: {
    id: 'tron',
    family: 'tron',
    name: 'TRON',
    nativeCurrency: { symbol: 'TRX', decimals: 6 },
    explorerUrl: 'https://tronscan.org',
    testnetExplorerUrl: 'https://nile.tronscan.org',
    rpcUrls: ['https://api.trongrid.io'],
    testnetRpcUrls: ['https://nile.trongrid.io', 'https://api.shasta.trongrid.io'],
  },
};

/** Every supported chain id, in registry order. */
export const CHAIN_IDS = Object.keys(CHAINS) as readonly ChainId[];

/** Looks up a chain definition, throwing for unknown ids. */
export function getChain(chainId: ChainId): ChainDefinition {
  const definition = CHAINS[chainId];
  if (definition === undefined) {
    throw new UnsupportedChainError(chainId);
  }
  return definition;
}
