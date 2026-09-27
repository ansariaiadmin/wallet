import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { BroadcastError, InvalidAddressError, RpcError } from './errors';
import { formatUnits } from './format';
import { isSolanaAddress } from './address';
import type {
  Balance,
  BroadcastResult,
  ChainConnector,
  ChainDefinition,
  FeeEstimate,
  FeeRequest,
  Network,
  RetryOptions,
} from './types';
import { isNodeVerdict, rpcReason, withFallback, withTimeout } from './transport';

/** Default compute-unit limit for a simple SOL/SPL transfer. */
const DEFAULT_COMPUTE_UNITS = 200_000n;

/**
 * SPL Token-2022 program id (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
 * Kept as a literal because @solana/spl-token is not a dependency of this package.
 */
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/** Classic SPL Token program id (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). */
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Solana connector built on @solana/web3.js. */
export class SolanaConnector implements ChainConnector {
  constructor(
    private readonly definition: ChainDefinition,
    private readonly activeNetwork: Network,
    private readonly rpcUrls: readonly string[],
    private readonly retry?: RetryOptions,
  ) {}

  get chainId(): 'solana' {
    return 'solana';
  }

  get network(): Network {
    return this.activeNetwork;
  }

  async getNativeBalance(address: string): Promise<Balance> {
    const pubkey = this.publicKey(address);
    const lamports = await this.call((connection) => connection.getBalance(pubkey));

    return {
      chainId: 'solana',
      network: this.activeNetwork,
      address,
      unit: 'native',
      symbol: this.definition.nativeCurrency.symbol,
      decimals: this.definition.nativeCurrency.decimals,
      amount: BigInt(lamports),
      formatted: formatUnits(BigInt(lamports), 9),
    };
  }

  async getTokenBalances(address: string, tokens?: readonly string[]): Promise<readonly Balance[]> {
    const pubkey = this.publicKey(address);
    const wanted = tokens === undefined ? null : new Set(tokens);

    const accounts = await this.call(async (connection) => {
      // Classic SPL Token plus the Token-2022 program.
      const [classic, token2022] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN_PROGRAM_ID }),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);
      return [...classic.value, ...token2022.value];
    });

    const balances: Balance[] = [];
    for (const account of accounts) {
      const info = account.account.data.parsed?.info as
        { mint: string; tokenAmount: { amount: string; decimals: number } } | undefined;
      if (info === undefined) continue;
      if (wanted !== null && !wanted.has(info.mint)) continue;

      const amount = BigInt(info.tokenAmount.amount);
      balances.push({
        chainId: 'solana',
        network: this.activeNetwork,
        address,
        unit: 'token',
        // Symbol requires metadata lookup; mint address identifies the token.
        symbol: '',
        decimals: info.tokenAmount.decimals,
        amount,
        formatted: formatUnits(amount, info.tokenAmount.decimals),
        tokenAddress: info.mint,
      });
    }
    return balances;
  }

  async estimateFee(request: FeeRequest): Promise<FeeEstimate> {
    const from = this.publicKey(request.from);
    const to = this.publicKey(request.to);

    const fee = await this.call(async (connection) => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      // Estimation scaffolding only: a plain transfer message stands in for the
      // real transaction. SPL transfers cost the same base fee per signature.
      const transaction = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: to,
          lamports: Number(request.amount ?? 0n),
        }),
      );
      const message = transaction.compileMessage();
      const result = await connection.getFeeForMessage(message);
      return BigInt(result.value ?? 5000);
    });

    return {
      chainId: 'solana',
      network: this.activeNetwork,
      nativeSymbol: this.definition.nativeCurrency.symbol,
      nativeDecimals: this.definition.nativeCurrency.decimals,
      units: 1n,
      unitPrice: fee,
      maxCost: fee,
      formattedMaxCost: formatUnits(fee, 9),
      details: {
        signatures: '1',
        computeUnitLimit: DEFAULT_COMPUTE_UNITS.toString(),
        ataRentExcluded: 'true',
      },
    };
  }

  async broadcast(signedTransaction: string): Promise<BroadcastResult> {
    const raw = decodeSignedTransaction(signedTransaction);
    let signature: string;
    try {
      // A simulation failure is the node's verdict, so do not burn the other
      // endpoints on a transaction that is already rejected.
      signature = await this.call(
        (connection) => connection.sendRawTransaction(raw),
        isNodeVerdict,
      );
    } catch (error) {
      throw new BroadcastError('solana', `Broadcast rejected: ${rpcReason(error)}`, error);
    }

    return {
      chainId: 'solana',
      network: this.activeNetwork,
      txHash: signature,
      explorerUrl: `${this.explorerBase()}/tx/${signature}`,
    };
  }

  private call<T>(
    operation: (connection: Connection) => Promise<T>,
    stopOn?: (error: RpcError) => boolean,
  ): Promise<T> {
    return withFallback(
      'solana',
      this.rpcUrls,
      async (endpoint) => {
        const connection = new Connection(endpoint, 'confirmed');
        return withTimeout(
          operation(connection),
          this.retry?.timeoutMs ?? 10_000,
          'solana',
          endpoint,
        );
      },
      this.retry,
      undefined,
      stopOn,
    );
  }

  private explorerBase(): string {
    return this.activeNetwork === 'testnet'
      ? (this.definition.testnetExplorerUrl ?? this.definition.explorerUrl)
      : this.definition.explorerUrl;
  }

  private publicKey(address: string): PublicKey {
    if (!isSolanaAddress(address)) {
      throw new InvalidAddressError('solana', address);
    }
    return new PublicKey(address);
  }
}

/** Accepts base64 (default) or `0x` hex signed transactions. */
export function decodeSignedTransaction(signedTransaction: string): Buffer {
  const trimmed = signedTransaction.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed.slice(2), 'hex');
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'base64');
  }
  throw new RpcError('solana', 'local', 'signed transaction must be base64 or 0x-prefixed hex');
}
