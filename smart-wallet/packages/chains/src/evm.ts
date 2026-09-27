import { createPublicClient, erc20Abi, http, isAddress, type PublicClient } from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
  type Chain,
} from 'viem/chains';
import { BroadcastError, InvalidAddressError } from './errors';
import { formatUnits } from './format';
import type { RpcError } from './errors';
import { isNodeVerdict, rpcReason, withFallback, withTimeout } from './transport';
import type {
  Balance,
  BroadcastResult,
  ChainConnector,
  ChainDefinition,
  EvmChainId,
  FeeEstimate,
  FeeRequest,
  Network,
  RetryOptions,
} from './types';

/** viem chain objects per supported EVM chain and network. */
const VIEM_CHAINS: Record<EvmChainId, { mainnet: Chain; testnet: Chain }> = {
  ethereum: { mainnet, testnet: sepolia },
  polygon: { mainnet: polygon, testnet: polygonAmoy },
  base: { mainnet: base, testnet: baseSepolia },
  arbitrum: { mainnet: arbitrum, testnet: arbitrumSepolia },
  optimism: { mainnet: optimism, testnet: optimismSepolia },
  bsc: { mainnet: bsc, testnet: bscTestnet },
};

/**
 * EVM connector built on viem.
 *
 * Retries and endpoint fallback are handled by the shared {@link withFallback}
 * policy so every family fails with the same error shape. This layer never
 * touches private keys: it only reads state and broadcasts signed payloads.
 */
export class EvmConnector implements ChainConnector {
  constructor(
    private readonly definition: ChainDefinition,
    private readonly activeNetwork: Network,
    private readonly rpcUrls: readonly string[],
    private readonly retry?: RetryOptions,
  ) {}

  get chainId(): EvmChainId {
    return this.definition.id as EvmChainId;
  }

  get network(): Network {
    return this.activeNetwork;
  }

  async getNativeBalance(address: string): Promise<Balance> {
    this.assertAddress(address);
    const amount = await this.call((client) =>
      client.getBalance({ address: address as `0x${string}` }),
    );
    return this.toBalance(address, 'native', this.definition.nativeCurrency.symbol, amount);
  }

  async getTokenBalances(address: string, tokens?: readonly string[]): Promise<readonly Balance[]> {
    this.assertAddress(address);
    if (tokens === undefined) {
      // ERC-20 enumeration needs an indexer; callers pass the tokens they hold.
      return [];
    }

    const balances: Balance[] = [];
    for (const token of tokens) {
      try {
        const amount = await this.call((client) =>
          client.readContract({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
          }),
        );
        const decimals = await this.call((client) =>
          client.readContract({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
        );
        const symbol = await this.call((client) =>
          client.readContract({
            address: token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
        );
        balances.push(
          this.toBalance(address, 'token', String(symbol), amount as bigint, {
            tokenAddress: token,
            decimals: Number(decimals),
          }),
        );
      } catch (error) {
        throw new Error(
          `Failed to read ERC-20 ${token} on ${this.definition.id}: ${(error as Error).message}`,
          { cause: error },
        );
      }
    }
    return balances;
  }

  async estimateFee(request: FeeRequest): Promise<FeeEstimate> {
    this.assertAddress(request.from);
    this.assertAddress(request.to);
    if (request.token !== undefined) {
      this.assertAddress(request.token);
    }

    const gasLimit = await this.call((client) =>
      client.estimateGas({
        account: request.from as `0x${string}`,
        to: request.to as `0x${string}`,
        value: request.amount,
        data: request.data as `0x${string}` | undefined,
      }),
    );
    const fees = await this.call((client) => client.estimateFeesPerGas());

    const unitPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const maxCost = gasLimit * unitPrice;

    return {
      chainId: this.definition.id,
      network: this.activeNetwork,
      nativeSymbol: this.definition.nativeCurrency.symbol,
      nativeDecimals: this.definition.nativeCurrency.decimals,
      units: gasLimit,
      unitPrice,
      maxCost,
      formattedMaxCost: formatUnits(maxCost, this.definition.nativeCurrency.decimals),
      details: {
        gasLimit: gasLimit.toString(),
        maxFeePerGas: unitPrice.toString(),
        // OP-stack L1 data fees are not included; add them when calldata pricing matters.
        l1DataFeeIncluded: 'false',
      },
    };
  }

  async broadcast(signedTransaction: string): Promise<BroadcastResult> {
    let txHash: string;
    try {
      // A node that rejects the transaction answers with a JSON-RPC error, so
      // there is nothing to gain from trying the remaining endpoints.
      txHash = await this.call(
        (client) =>
          client.sendRawTransaction({ serializedTransaction: signedTransaction as `0x${string}` }),
        isNodeVerdict,
      );
    } catch (error) {
      throw new BroadcastError(
        this.definition.id,
        `Broadcast rejected: ${rpcReason(error)}`,
        error,
      );
    }

    return {
      chainId: this.definition.id,
      network: this.activeNetwork,
      txHash,
      explorerUrl: `${this.explorerBase()}/tx/${txHash}`,
    };
  }

  /** Runs `operation` against every endpoint with the shared retry policy. */
  private call<T>(
    operation: (client: PublicClient) => Promise<T>,
    stopOn?: (error: RpcError) => boolean,
  ): Promise<T> {
    const chain = VIEM_CHAINS[this.definition.id as EvmChainId][this.activeNetwork];
    const timeoutMs = this.retry?.timeoutMs ?? 10_000;

    return withFallback(
      this.definition.id,
      this.rpcUrls,
      async (endpoint) => {
        const client = createPublicClient({
          chain,
          transport: http(endpoint, { retryCount: 0, timeout: timeoutMs }),
        });
        return withTimeout(operation(client), timeoutMs, this.definition.id, endpoint);
      },
      this.retry,
      undefined,
      stopOn,
    );
  }

  private toBalance(
    address: string,
    unit: 'native' | 'token',
    symbol: string,
    amount: bigint,
    extra?: { tokenAddress: string; decimals: number },
  ): Balance {
    const decimals = extra?.decimals ?? this.definition.nativeCurrency.decimals;
    return {
      chainId: this.definition.id,
      network: this.activeNetwork,
      address,
      unit,
      symbol,
      decimals,
      amount,
      formatted: formatUnits(amount, decimals),
      ...(extra?.tokenAddress === undefined ? {} : { tokenAddress: extra.tokenAddress }),
    };
  }

  private explorerBase(): string {
    return this.activeNetwork === 'testnet'
      ? (this.definition.testnetExplorerUrl ?? this.definition.explorerUrl)
      : this.definition.explorerUrl;
  }

  private assertAddress(address: string): void {
    if (!isAddress(address)) {
      throw new InvalidAddressError(this.definition.id, address);
    }
  }
}
