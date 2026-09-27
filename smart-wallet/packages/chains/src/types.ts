/** Chains with a supported connector. */
export type EvmChainId = 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'optimism' | 'bsc';
export type ChainId = EvmChainId | 'solana' | 'tron';
export type ChainFamily = 'evm' | 'solana' | 'tron';

/** Which network of a chain to talk to. */
export type Network = 'mainnet' | 'testnet';

/** A token or coin balance held by an address. */
export interface Balance {
  readonly chainId: ChainId;
  readonly network: Network;
  readonly address: string;
  readonly unit: 'native' | 'token';
  readonly symbol: string;
  readonly decimals: number;
  /** Raw amount in the smallest unit (wei, lamports, sun, token base units). */
  readonly amount: bigint;
  /** Human-readable amount, e.g. `"0.5"`. */
  readonly formatted: string;
  /** Contract address for tokens (`undefined` for native balances). */
  readonly tokenAddress?: string;
}

/** What a caller wants priced before signing. */
export interface FeeRequest {
  readonly from: string;
  readonly to: string;
  /** Value in the chain's native minor units (wei, lamports, sun). */
  readonly amount?: bigint;
  /** Token contract/mint address when transferring a token. */
  readonly token?: string;
  /** ABI-encoded calldata for EVM contract calls. */
  readonly data?: string;
}

/** A pre-signing cost estimate. */
export interface FeeEstimate {
  readonly chainId: ChainId;
  readonly network: Network;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  /** Gas units (EVM), compute units (Solana) or bandwidth (TRON). */
  readonly units: bigint;
  /** Price of one unit in native minor units. */
  readonly unitPrice: bigint;
  /** Worst-case total cost in native minor units. */
  readonly maxCost: bigint;
  readonly formattedMaxCost: string;
  /** Family-specific extras, e.g. `{ l1DataFee: "1200" }`. */
  readonly details?: Readonly<Record<string, string>>;
}

/** Result of broadcasting an already-signed transaction. */
export interface BroadcastResult {
  readonly chainId: ChainId;
  readonly network: Network;
  readonly txHash: string;
  readonly explorerUrl?: string;
}

/** Static description of a supported chain. */
export interface ChainDefinition {
  readonly id: ChainId;
  readonly family: ChainFamily;
  readonly name: string;
  readonly nativeCurrency: { readonly symbol: string; readonly decimals: number };
  /** Explorer base URL without trailing slash. */
  readonly explorerUrl: string;
  /** Ordered RPC endpoints: first is primary, the rest are fallbacks. */
  readonly rpcUrls: readonly string[];
  readonly testnetRpcUrls: readonly string[];
  /** Explorer for the testnet of this chain. */
  readonly testnetExplorerUrl?: string;
}

/** Retry/backoff policy shared by every connector. */
export interface RetryOptions {
  /** Attempts per endpoint before moving to the next one. Default 2. */
  readonly attempts?: number;
  /** Delay before the first retry, doubled per attempt. Default 150ms. */
  readonly delayMs?: number;
  /** Per-request timeout. Default 10s. */
  readonly timeoutMs?: number;
}

/** Options accepted when creating a connector. */
export interface ConnectorOptions {
  readonly network?: Network;
  /** Overrides the built-in endpoint list (order = priority). */
  readonly rpcUrls?: readonly string[];
  readonly retry?: RetryOptions;
}

/** The multi-chain surface every connector implements. */
export interface ChainConnector {
  readonly chainId: ChainId;
  readonly network: Network;
  /** Native coin balance of `address`. */
  getNativeBalance(address: string): Promise<Balance>;
  /**
   * Token balances of `address`. When `tokens` is given only those
   * contracts/mints are queried, otherwise every token the chain can
   * enumerate is returned.
   */
  getTokenBalances(address: string, tokens?: readonly string[]): Promise<readonly Balance[]>;
  /** Worst-case cost of `request` in native minor units, before signing. */
  estimateFee(request: FeeRequest): Promise<FeeEstimate>;
  /** Broadcasts an already-signed transaction and returns its hash. */
  broadcast(signedTransaction: string): Promise<BroadcastResult>;
}
