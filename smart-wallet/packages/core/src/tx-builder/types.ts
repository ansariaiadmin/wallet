import { WalletError } from '../errors';
import { getChain } from '@chains/chains';
import { formatUnits } from '@chains/format';
import type { ChainConnector, ChainId, FeeEstimate, Network, RetryOptions } from '@chains';

/** Raised when a transaction cannot be built from the given parameters. */
export class BuilderError extends WalletError {
  constructor(message: string) {
    super(message);
  }
}

/** Token descriptor shared by EVM (ERC-20) and TRON (TRC-20) transfers. */
export interface ContractToken {
  readonly address: string;
  readonly decimals: number;
}

/** Token descriptor for SPL token transfers. */
export interface SplToken {
  readonly mint: string;
  readonly decimals: number;
  /** Sender's associated token account; derived from `from` when omitted. */
  readonly ownerAta?: string;
}

/** Fields shared by every family. */
export interface TxParamsBase {
  readonly chainId: string;
  readonly network?: string;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  /**
   * Convenience slot for the P3 connector used to price the transaction.
   * `BuildTxOptions.connector` takes precedence when both are given.
   */
  readonly connector?: ChainConnector;
}

export interface EvmTxParams extends TxParamsBase {
  readonly family: 'evm';
  readonly token?: ContractToken;
}

export interface SolanaTxParams extends TxParamsBase {
  readonly family: 'solana';
  readonly token?: SplToken;
}

export interface TronTxParams extends TxParamsBase {
  readonly family: 'tron';
  readonly token?: ContractToken;
}

/** What the caller wants built. Discriminated on `family`. */
export type TxParams = EvmTxParams | SolanaTxParams | TronTxParams;

/** An unsigned transaction, ready to be handed to the signing phase. */
export interface UnsignedTx {
  readonly family: string;
  readonly chainId: string;
  readonly network: string;
  /** Serialized transaction bytes (EVM, Solana) or JSON text (TRON). */
  readonly serialized: Uint8Array | string;
  /** Fee estimate from P3; zeroed when no connector was supplied. */
  readonly fee: FeeEstimate;
  /** Family specific extras: nonce, gas, blockhash, txID, warnings, … */
  readonly meta: Record<string, unknown>;
}

/**
 * Everything the builder needs besides `TxParams`.
 *
 * The builder never touches private keys and never signs: it only assembles
 * and serializes an unsigned transaction. Chain state it cannot know on its
 * own (nonce, blockhash, fee limit) is either supplied here or left at a safe
 * placeholder with a warning recorded in `UnsignedTx.meta.warnings`.
 */
export interface BuildTxOptions {
  /** P3 connector used for fee estimation; without it fee fields stay `0n`. */
  readonly connector?: ChainConnector;
  /** Endpoint list for the TRON builder (order = priority). */
  readonly rpcUrls?: readonly string[];
  readonly retry?: RetryOptions;
  /** EVM: account nonce. Built as `0n` with a warning when omitted. */
  readonly nonce?: bigint;
  /** EVM: numeric chain id for EIP-1559; derived from `chainId` when omitted. */
  readonly evmChainId?: number;
  /** EVM: priority fee tip; `0n` when omitted (still a valid EIP-1559 tx). */
  readonly maxPriorityFeePerGas?: bigint;
  /** Solana: recent blockhash; a placeholder is used (and warned) when omitted. */
  readonly recentBlockhash?: string;
  /** Solana: block height after which the blockhash expires. */
  readonly lastValidBlockHeight?: number;
  /** Solana: fetches a fresh blockhash, e.g. from a P3 connector. */
  readonly blockhashProvider?: () => Promise<RecentBlockhash>;
  /** TRON: fee limit in sun for TRC-20 transfers. */
  readonly feeLimit?: bigint;
}

/** Shape of `getLatestBlockhash()` results, as returned by web3.js. */
export interface RecentBlockhash {
  readonly blockhash: string;
  readonly lastValidBlockHeight?: number;
}

/** Maps the loose `network` string of `TxParams` onto the P3 union. */
export function resolveNetwork(network: string | undefined): Network {
  return network === 'testnet' ? 'testnet' : 'mainnet';
}

/** Native currency metadata, from the P3 registry when the chain is known. */
export function nativeCurrencyOf(
  family: string,
  chainId: string,
): {
  readonly symbol: string;
  readonly decimals: number;
} {
  try {
    const definition = getChain(chainId as ChainId);
    return {
      symbol: definition.nativeCurrency.symbol,
      decimals: definition.nativeCurrency.decimals,
    };
  } catch {
    const fallback = FAMILY_NATIVE_CURRENCY[family];
    return fallback ?? { symbol: '', decimals: 0 };
  }
}

/** Connector to price with: `options` wins over the one carried on `params`. */
export function connectorOf(
  params: TxParamsBase,
  options: BuildTxOptions,
): ChainConnector | undefined {
  return options.connector ?? params.connector;
}

/**
 * Fee estimate used when no connector is available. Every amount stays `0n`
 * and `details.estimated` says why, so callers can refuse to sign it.
 */
export function unestimatedFee(family: string, chainId: string, network: Network): FeeEstimate {
  const { symbol, decimals } = nativeCurrencyOf(family, chainId);
  return {
    chainId: chainId as ChainId,
    network,
    nativeSymbol: symbol,
    nativeDecimals: decimals,
    units: 0n,
    unitPrice: 0n,
    maxCost: 0n,
    formattedMaxCost: formatUnits(0n, decimals),
    details: {
      estimated: 'false',
      note: 'no connector supplied: fee fields are zero, estimate the fee before signing',
    },
  };
}

const FAMILY_NATIVE_CURRENCY: Readonly<
  Record<string, { readonly symbol: string; readonly decimals: number }>
> = {
  evm: { symbol: 'ETH', decimals: 18 },
  solana: { symbol: 'SOL', decimals: 9 },
  tron: { symbol: 'TRX', decimals: 6 },
};

/*
 * Shared input guards. They live next to the types so every family builder
 * rejects malformed input with the same {@link BuilderError}.
 */

/** Rejects negative amounts, which no transfer instruction can express. */
export function requireAmount(amount: bigint): bigint {
  if (typeof amount !== 'bigint') {
    throw new BuilderError(`amount must be a bigint, received ${typeof amount}`);
  }
  if (amount < 0n) {
    throw new BuilderError(`amount must not be negative: ${amount}`);
  }
  return amount;
}

/** Decimals are a `u8` on every supported token standard. */
export function requireDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new BuilderError(`decimals must be an integer between 0 and 255: ${decimals}`);
  }
  return decimals;
}
