/**
 * Public types of the wallet SDK.
 *
 * Everything here is a plain type: no classes, no implementations. The SDK
 * surface is intentionally chain-agnostic — a caller names a `NetworkId` and
 * the facade picks the family, the connector and the derivation path.
 */

/** Chain families the SDK can derive keys and build transactions for. */
export type ChainFamily = 'evm' | 'solana' | 'tron';

/** Every network the SDK can address. Testnets are distinct ids. */
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

/** Optional SDK configuration; every field has a safe default. */
export interface WalletConfig {
  /** Networks this wallet may talk to. Defaults to all of them. */
  networks?: NetworkId[];
  /** `mock` (default) uses the deterministic P7 providers. */
  priceProviders?: 'mock' | 'live';
  /** `mock` (default) uses the deterministic P8 providers. */
  riskProviders?: 'mock' | 'live';
  /** RPC endpoint overrides, for tests and private nodes. */
  rpcUrls?: Readonly<Partial<Record<NetworkId, readonly string[]>>>;
}

/** A freshly generated wallet. */
export interface WalletCreateResult {
  /** BIP-39 phrase. The caller must store it securely and NEVER log it. */
  mnemonic: string;
  /** Derived address per family, at the default derivation path. */
  address: Record<ChainFamily, string>;
}

/** A wallet restored from an existing mnemonic. */
export interface WalletImportResult {
  address: Record<ChainFamily, string>;
}

/** A balance snapshot for one address. */
export interface BalanceResult {
  network: NetworkId;
  address: string;
  /** Human-readable native balance, e.g. `"1.234"`. */
  native: string;
  tokens: Array<{ symbol: string; balance: string; address: string }>;
}

/** A pre-signing fee estimate. */
export interface FeeEstimate {
  network: NetworkId;
  /** Worst-case fee in the native currency, human readable. */
  native: string;
  confidence: 'low' | 'medium' | 'high';
}

/** A signed transaction, ready to broadcast (the SDK never broadcasts). */
export interface BuildSignResult {
  network: NetworkId;
  /** `0x`-prefixed hex on EVM, raw bytes on Solana and TRON. */
  signedTx: string | Uint8Array;
}

/** Result of broadcasting an already-signed transaction. */
export interface BroadcastResult {
  /** Transaction hash as the chain reported it. */
  txHash: string;
  /** Network the transaction was broadcast on. */
  network: NetworkId;
  /** When it was broadcast, in ms. */
  broadcastAt: number;
}

/** Lifecycle of a transaction as the SDK reports it. */
export type TxStatus = 'pending' | 'confirmed' | 'failed' | 'not_found';

/** Status of one transaction, read from the local record or the chain. */
export interface TxStatusResult {
  txHash: string;
  network: NetworkId;
  status: TxStatus;
  /** Blocks (or slots) on top of the transaction; `0` until it is confirmed. */
  confirmations: number;
  /** When the status was read, in ms. */
  checkedAt: number;
}

/** A swap quote as the SDK reports it. */
export interface QuoteSummary {
  fromToken: string;
  toToken: string;
  /** Amount sold, decimal string in the smallest unit of `fromToken`. */
  amountIn: string;
  /** Minimum amount received after slippage, same unit as `toToken`. */
  amountOut: string;
  adapter: string;
  /** Aggregator fee in basis points, as a string. */
  estimatedFee: string;
}

/** A price as the SDK reports it. */
export interface PriceSummary {
  symbol: string;
  price: number;
  /** 24 hour change in basis points, signed. */
  change24h: number;
  confidence: 'high' | 'medium';
}

/** A screening verdict as the SDK reports it. */
export interface RiskSummary {
  overallRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  flagCount: number;
  assessedAt: number;
}
