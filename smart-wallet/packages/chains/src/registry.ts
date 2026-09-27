import { getChain } from './chains';
import { EvmConnector } from './evm';
import { SolanaConnector } from './solana';
import { TronConnector } from './tron';
import { UnsupportedChainError } from './errors';
import type { ChainConnector, ChainId, ConnectorOptions, Network } from './types';

/** Endpoint list for a chain/network, honouring a caller override. */
export function resolveRpcUrls(chainId: ChainId, options?: ConnectorOptions): readonly string[] {
  const definition = getChain(chainId);
  if (options?.rpcUrls !== undefined && options.rpcUrls.length > 0) {
    return options.rpcUrls;
  }
  const network = options?.network ?? 'mainnet';
  const urls = network === 'testnet' ? definition.testnetRpcUrls : definition.rpcUrls;
  if (urls.length === 0) {
    throw new UnsupportedChainError(`${chainId} has no ${network} endpoints configured`);
  }
  return urls;
}

/** Creates a connector for `chainId` with optional custom endpoints. */
export function createConnector(chainId: ChainId, options?: ConnectorOptions): ChainConnector {
  const definition = getChain(chainId);
  const network: Network = options?.network ?? 'mainnet';
  const rpcUrls = resolveRpcUrls(chainId, options);
  const retry = options?.retry;

  switch (definition.family) {
    case 'evm':
      return new EvmConnector(definition, network, rpcUrls, retry);
    case 'solana':
      return new SolanaConnector(definition, network, rpcUrls, retry);
    case 'tron':
      return new TronConnector(definition, network, rpcUrls, retry);
    default:
      throw new UnsupportedChainError(chainId);
  }
}

/** Creates one connector per requested chain. */
export function createConnectors(
  chainIds: readonly ChainId[],
  options?: ConnectorOptions,
): Readonly<Record<string, ChainConnector>> {
  const connectors: Record<string, ChainConnector> = {};
  for (const chainId of chainIds) {
    connectors[chainId] = createConnector(chainId, options);
  }
  return connectors;
}
