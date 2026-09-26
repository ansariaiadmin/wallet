import {
  buildTx,
  createWallet,
  importWallet,
  mockBinanceProvider,
  mockChainalysisProvider,
  mockCoinGeckoProvider,
  mockKrakenProvider,
  mockOfacProvider,
  mockTokenWatchProvider,
  PriceOracle,
  RiskChecker,
  sign,
  unlockWallet,
  type ContractToken,
  type CreatedWallet,
  type EncryptedKeystore,
  type SplToken,
  type TxParams,
  type UnlockedWallet,
} from '@wallet/core';
import { createConnector, type ChainConnector } from '@wallet/chains';
import {
  mockEvmAdapter,
  mockSolanaAdapter,
  mockTronAdapter,
  SwapRouter,
  type SwapQuote,
} from '@wallet/router';
import { SdkError, toSdkError } from './errors';
import {
  FAMILY_DERIVATION_PATH,
  NETWORK_CHAIN_ID,
  NETWORK_FAMILY,
  NETWORK_IDS,
  NETWORK_IS_TESTNET,
  isNetworkId,
} from './networks';
import { readTransactionStatus, recordBroadcast } from './tx-status';
import type {
  BalanceResult,
  BroadcastResult,
  BuildSignResult,
  ChainFamily,
  FeeEstimate,
  NetworkId,
  PriceSummary,
  QuoteSummary,
  RiskSummary,
  TxStatusResult,
  WalletConfig,
  WalletCreateResult,
  WalletImportResult,
} from './types';

/** Every method is offline: connectors only talk to endpoints a caller supplies. */
export class SmartWallet {
  private readonly networks: readonly NetworkId[];
  private readonly priceMode: 'mock' | 'live';
  private readonly riskMode: 'mock' | 'live';
  private readonly rpcUrls: Readonly<Partial<Record<NetworkId, readonly string[]>>>;

  /** Encrypted keystore blob; `undefined` until create() or import(). */
  private encrypted: EncryptedKeystore | undefined;
  /** Decrypted wallet held after unlock(); zeroed by lock()/destroy(). */
  private unlocked: UnlockedWallet | undefined;

  constructor(config: WalletConfig = {}) {
    this.networks = config.networks ?? NETWORK_IDS;
    this.priceMode = config.priceProviders ?? 'mock';
    this.riskMode = config.riskProviders ?? 'mock';
    this.rpcUrls = config.rpcUrls ?? {};
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Generates a fresh wallet and keeps its encrypted keystore in memory.
   *
   * @param password encrypts the keystore; the same string unlocks it later.
   * @param passphrase optional BIP-39 passphrase ("25th word"); it changes the
   *   seed and therefore every derived address.
   */
  async create(password: string, passphrase?: string): Promise<WalletCreateResult> {
    this.requirePassword(password);
    const wallet = await this.guard(() =>
      createWallet(password, passphrase === undefined ? {} : { passphrase }),
    );
    this.remember(wallet);
    return { mnemonic: wallet.mnemonic, address: this.deriveAddresses(password) };
  }

  /** Restores a wallet from an existing BIP-39 mnemonic. */
  async import(
    mnemonic: string,
    password: string,
    passphrase?: string,
  ): Promise<WalletImportResult> {
    this.requirePassword(password);
    const wallet = await this.guard(() =>
      importWallet(mnemonic, password, passphrase === undefined ? {} : { passphrase }),
    );
    this.remember(wallet);
    return { address: this.deriveAddresses(password) };
  }

  /** Decrypts the keystore and keeps the wallet in memory for signing. */
  async unlock(password: string): Promise<void> {
    this.requirePassword(password);
    const encrypted = this.requireKeystore();
    try {
      this.destroyUnlocked();
      this.unlocked = unlockWallet(encrypted, password);
    } catch (error) {
      throw toSdkError(error, 'LOCKED');
    }
  }

  /** Zeroes the in-memory seed; the wallet must be unlocked again to sign. */
  lock(): void {
    this.destroyUnlocked();
  }

  /** Alias of {@link lock}, for callers that think in terms of teardown. */
  destroy(): void {
    this.destroyUnlocked();
  }

  // ------------------------------------------------------------ balances/fees

  /** Reads the native balance and the known token balances of `address`. */
  async getBalance(network: NetworkId, address: string): Promise<BalanceResult> {
    const connector = this.connectorFor(network);
    try {
      const native = await connector.getNativeBalance(address);
      const tokens = await connector.getTokenBalances(address);
      return {
        network,
        address,
        native: native.formatted,
        tokens: tokens.map((token) => ({
          symbol: token.symbol,
          balance: token.formatted,
          address: token.tokenAddress ?? '',
        })),
      };
    } catch (error) {
      throw toSdkError(error, 'CHAIN_ERROR');
    }
  }

  /** Worst-case fee for a transfer, in the native currency. */
  async estimateFee(
    network: NetworkId,
    params: { from: string; to: string; amount: string; tokenAddress?: string },
  ): Promise<FeeEstimate> {
    const connector = this.connectorFor(network);
    const amount = this.parseAmount(params.amount);
    try {
      const fee = await connector.estimateFee({
        from: params.from,
        to: params.to,
        amount,
        token: params.tokenAddress,
      });
      return { network, native: fee.formattedMaxCost, confidence: 'medium' };
    } catch (error) {
      throw toSdkError(error, 'CHAIN_ERROR');
    }
  }

  // ---------------------------------------------------------------- build/sign

  /**
   * Builds and signs a transaction without broadcasting it.
   *
   * The keystore is unlocked with `password`, the key for the network's family
   * is derived, the key bytes are handed to the signer as a copy and zeroed in
   * a `finally` block, and the unlocked wallet is destroyed afterwards — so no
   * key material outlives this call.
   */
  async buildAndSign(params: {
    network: NetworkId;
    type: 'native' | 'token';
    from: string;
    to: string;
    amount: string;
    tokenAddress?: string;
    decimals?: number;
    password: string;
  }): Promise<BuildSignResult> {
    this.requirePassword(params.password);
    const family = this.familyFor(params.network);
    const amount = this.parseAmount(params.amount);

    let token: ContractToken | SplToken | undefined;
    if (params.type === 'token') {
      if (params.tokenAddress === undefined || params.tokenAddress.trim() === '') {
        throw new SdkError('INVALID_INPUT', 'tokenAddress is required when type is "token"');
      }
      if (params.decimals === undefined || !Number.isInteger(params.decimals)) {
        throw new SdkError('INVALID_INPUT', 'decimals is required when type is "token"');
      }
      token =
        family === 'solana'
          ? { mint: params.tokenAddress, decimals: params.decimals }
          : { address: params.tokenAddress, decimals: params.decimals };
    }

    const txParams: TxParams =
      family === 'solana'
        ? {
            family: 'solana',
            chainId: NETWORK_CHAIN_ID[params.network],
            network: this.networkName(params.network),
            from: params.from,
            to: params.to,
            amount,
            token: token as SplToken | undefined,
          }
        : {
            family,
            chainId: NETWORK_CHAIN_ID[params.network],
            network: this.networkName(params.network),
            from: params.from,
            to: params.to,
            amount,
            token: token as ContractToken | undefined,
          };

    const unsigned = await this.guard(() => buildTx(txParams));

    const encrypted = this.requireKeystore();
    let unlocked: UnlockedWallet;
    try {
      unlocked = unlockWallet(encrypted, params.password);
    } catch (error) {
      throw toSdkError(error, 'LOCKED');
    }

    try {
      const derived = unlocked.deriveKey(FAMILY_DERIVATION_PATH[family]);
      // A private copy of the key bytes: the signer zeroes what it is given.
      const key = Uint8Array.from(Buffer.from(derived.privateKey.replace(/^0x/, ''), 'hex'));
      try {
        const signed = await this.guard(() => sign({ unsignedTx: unsigned, privateKey: key }));
        return {
          network: params.network,
          signedTx: family === 'evm' ? toHexPayload(signed.serialized) : signed.serialized,
        };
      } finally {
        key.fill(0);
      }
    } finally {
      unlocked.destroy();
    }
  }

  // ------------------------------------------------------------- broadcast

  /**
   * Broadcasts an already-signed transaction.
   *
   * The SDK only forwards what it is given: it never signs, never derives keys
   * and never holds key material. The payload is re-encoded for the family —
   * `0x` hex on EVM, base64 on Solana — because the connectors take strings.
   *
   * @throws SdkError UNSUPPORTED_NETWORK for a network the wallet cannot reach,
   *   INVALID_INPUT for a payload that is not a non-empty byte array, and
   *   BROADCAST_FAILED when the connector (or the encoding) refuses it.
   */
  async broadcast(network: NetworkId, signedTx: Uint8Array): Promise<BroadcastResult> {
    this.requireNetwork(network);
    const payload = toBroadcastPayload(NETWORK_FAMILY[network], signedTx);
    const connector = this.connectorFor(network);

    let txHash: string;
    try {
      txHash = (await connector.broadcast(payload)).txHash;
    } catch (error) {
      throw toSdkError(error, 'BROADCAST_FAILED');
    }

    const broadcastAt = Date.now();
    // Remembered so a later status call can report it without a chain read.
    recordBroadcast(network, txHash, broadcastAt);
    return { txHash, network, broadcastAt };
  }

  /**
   * Reads the status of a transaction.
   *
   * The shipped connectors cannot read a transaction back, so the answer comes
   * from this process's own record of what it broadcast: `pending` for a known
   * hash, `not_found` otherwise. A connector that implements
   * `getTransactionStatus` answers instead, and its failures become
   * `STATUS_FAILED`.
   */
  async getTxStatus(network: NetworkId, txHash: string): Promise<TxStatusResult> {
    this.requireNetwork(network);
    if (typeof txHash !== 'string' || txHash.trim() === '') {
      throw new SdkError('INVALID_INPUT', 'txHash is required');
    }
    const connector = this.connectorFor(network);

    let record: Awaited<ReturnType<typeof readTransactionStatus>>;
    try {
      record = await readTransactionStatus(connector, network, txHash);
    } catch (error) {
      throw toSdkError(error, 'STATUS_FAILED');
    }

    const checkedAt = Date.now();
    if (record === undefined) {
      return { txHash, network, status: 'not_found', confirmations: 0, checkedAt };
    }
    return {
      txHash,
      network,
      status: record.status,
      confirmations: record.confirmations,
      checkedAt,
    };
  }

  // ------------------------------------------------------------- price / risk

  /** USD price of `symbol` from the P7 oracle. */
  async getPrice(symbol: string): Promise<PriceSummary> {
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new SdkError('INVALID_INPUT', 'symbol is required');
    }
    const oracle = this.oracle();
    const price = await this.guard(() => oracle.fetchPrice(symbol));
    return {
      symbol: price.symbol,
      price: price.usdPrice,
      change24h: price.change24hBps,
      // The SDK surface has no 'low'; a fallback-only price is reported as
      // 'medium' so callers still see a conservative value.
      confidence: price.confidence === 'low' ? 'medium' : price.confidence,
    };
  }

  /** Heuristic screening verdict for an address. */
  async checkAddressRisk(address: string, chain?: string): Promise<RiskSummary> {
    if (typeof address !== 'string' || address.trim() === '') {
      throw new SdkError('INVALID_INPUT', 'address is required');
    }
    const checker = this.riskChecker();
    const result = await this.guard(() => checker.assessAddress({ address, chain }));
    return {
      overallRisk: result.overallRisk,
      flagCount: result.flags.length,
      assessedAt: result.assessedAt,
    };
  }

  /** Heuristic screening verdict for a token symbol. */
  async checkTokenRisk(symbol: string, chain?: string): Promise<RiskSummary> {
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new SdkError('INVALID_INPUT', 'symbol is required');
    }
    const checker = this.riskChecker();
    const result = await this.guard(() => checker.assessToken({ symbol, chain }));
    return {
      overallRisk: result.overallRisk,
      flagCount: result.flags.length,
      assessedAt: result.assessedAt,
    };
  }

  // --------------------------------------------------------------------- swap

  /** Best swap routes from the P6 router. */
  async getQuote(params: {
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    amount: string;
  }): Promise<{ best: QuoteSummary | null; all: QuoteSummary[] }> {
    // The whole body runs inside the guard, so any unexpected throw — not
    // just the router's own errors — leaves this method as an SdkError.
    return this.guard(async () => {
      const family = this.quoteFamily(params.fromChain);
      if (this.quoteFamily(params.toChain) !== family) {
        throw new SdkError(
          'INVALID_INPUT',
          `cross-chain quotes are not supported: ${params.fromChain} → ${params.toChain}`,
        );
      }
      const amountIn = this.parseAmount(params.amount);

      const router = this.swapRouter();
      const request = {
        family,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amountIn,
        slippageBps: 50,
        fromAddress: 'unknown',
      };

      const all = await router.allQuotes(request);
      if (all.length === 0) {
        return { best: null, all: [] };
      }
      const best = await router.bestQuote(request);
      return { best: toQuoteSummary(best), all: all.map(toQuoteSummary) };
    });
  }

  // ----------------------------------------------------------------- internals

  /**
   * Keeps only the encrypted keystore blob and forgets any unlocked wallet, so
   * create()/import() leave the instance in a locked state.
   */
  private remember(wallet: CreatedWallet): void {
    this.destroyUnlocked();
    this.encrypted = wallet.encrypted;
  }

  /**
   * Unlocks the keystore just long enough to derive one address per family,
   * then zeroes the seed again. create()/import() therefore leave the instance
   * locked.
   */
  private deriveAddresses(password: string): Record<ChainFamily, string> {
    const encrypted = this.requireKeystore();
    let unlocked: UnlockedWallet;
    try {
      unlocked = unlockWallet(encrypted, password);
    } catch (error) {
      throw toSdkError(error, 'LOCKED');
    }
    try {
      return {
        evm: unlocked.deriveKey(FAMILY_DERIVATION_PATH.evm).address,
        solana: unlocked.deriveKey(FAMILY_DERIVATION_PATH.solana).address,
        tron: unlocked.deriveKey(FAMILY_DERIVATION_PATH.tron).address,
      };
    } finally {
      unlocked.destroy();
    }
  }

  private destroyUnlocked(): void {
    this.unlocked?.destroy();
    this.unlocked = undefined;
  }

  private requireKeystore(): EncryptedKeystore {
    if (this.encrypted === undefined) {
      throw new SdkError('NO_WALLET', 'no wallet is loaded — call create() or import() first');
    }
    return this.encrypted;
  }

  private requirePassword(password: string): void {
    if (typeof password !== 'string' || password === '') {
      throw new SdkError('INVALID_INPUT', 'a non-empty password is required');
    }
  }

  private familyFor(network: NetworkId): ChainFamily {
    this.requireNetwork(network);
    return NETWORK_FAMILY[network];
  }

  private requireNetwork(network: NetworkId): void {
    if (!isNetworkId(network)) {
      throw new SdkError('UNSUPPORTED_NETWORK', `unsupported network: ${String(network)}`);
    }
    if (!this.networks.includes(network)) {
      throw new SdkError(
        'NETWORK_NOT_ENABLED',
        `network ${network} is not enabled for this wallet`,
      );
    }
  }

  private connectorFor(network: NetworkId): ChainConnector {
    this.requireNetwork(network);
    const overrides = this.rpcUrls[network];
    try {
      return createConnector(NETWORK_CHAIN_ID[network], {
        network: NETWORK_IS_TESTNET[network] ? 'testnet' : 'mainnet',
        ...(overrides === undefined ? {} : { rpcUrls: overrides }),
      });
    } catch (error) {
      throw toSdkError(error, 'CHAIN_ERROR');
    }
  }

  private networkName(network: NetworkId): string {
    return NETWORK_IS_TESTNET[network] ? 'testnet' : 'mainnet';
  }

  private oracle(): PriceOracle {
    if (this.priceMode !== 'mock') {
      throw new SdkError('UNSUPPORTED_MODE', 'live price providers are not implemented yet');
    }
    return new PriceOracle([mockCoinGeckoProvider, mockBinanceProvider, mockKrakenProvider]);
  }

  private riskChecker(): RiskChecker {
    if (this.riskMode !== 'mock') {
      throw new SdkError('UNSUPPORTED_MODE', 'live risk providers are not implemented yet');
    }
    return new RiskChecker([mockOfacProvider, mockChainalysisProvider, mockTokenWatchProvider]);
  }

  private swapRouter(): SwapRouter {
    return new SwapRouter([mockEvmAdapter, mockSolanaAdapter, mockTronAdapter]);
  }

  /** Maps a chain name onto a swap family, rejecting anything unknown. */
  private quoteFamily(chain: string): ChainFamily {
    const normalized = chain.trim().toLowerCase();
    if (normalized === 'solana' || normalized === 'solana-devnet') {
      return 'solana';
    }
    if (normalized === 'tron' || normalized === 'tron-nile' || normalized === 'tron-shasta') {
      return 'tron';
    }
    if (
      normalized === 'ethereum' ||
      normalized === 'polygon' ||
      normalized === 'base' ||
      normalized === 'arbitrum' ||
      normalized === 'optimism' ||
      normalized === 'bsc'
    ) {
      return 'evm';
    }
    throw new SdkError('UNSUPPORTED_CHAIN', `unsupported chain: ${chain}`);
  }

  /** Parses a decimal integer string, rejecting anything else. */
  private parseAmount(amount: string): bigint {
    if (typeof amount !== 'string' || !/^(?:0|[1-9]\d*)$/.test(amount.trim())) {
      throw new SdkError(
        'INVALID_INPUT',
        'amount must be a positive integer string in the smallest token unit',
      );
    }
    const value = BigInt(amount.trim());
    if (value <= 0n) {
      throw new SdkError('INVALID_INPUT', 'amount must be greater than zero');
    }
    return value;
  }

  /** Runs `work` and translates anything it throws into an {@link SdkError}. */
  private async guard<T>(work: () => T | Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toSdkError(error);
    }
  }
}

/** Renders a quote with bigint amounts as decimal strings. */
function toQuoteSummary(quote: SwapQuote): QuoteSummary {
  return {
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    adapter: quote.aggregator,
    estimatedFee: quote.feeBps.toString(),
  };
}

/**
 * Renders signed bytes in the encoding `family`'s connector expects.
 *
 * TRON is the exception: TronGrid broadcasts the signed transaction *object*
 * as JSON, which cannot be derived from raw bytes here, so the call fails with
 * a documented reason instead of guessing.
 */
function toBroadcastPayload(family: ChainFamily, signedTx: Uint8Array): string {
  if (!(signedTx instanceof Uint8Array)) {
    throw new SdkError('INVALID_INPUT', 'signedTx must be a Uint8Array');
  }
  if (signedTx.length === 0) {
    throw new SdkError('INVALID_INPUT', 'signedTx is empty');
  }
  if (family === 'evm') {
    return `0x${Buffer.from(signedTx).toString('hex')}`;
  }
  if (family === 'solana') {
    return Buffer.from(signedTx).toString('base64');
  }
  throw new SdkError(
    'BROADCAST_FAILED',
    'TRON broadcast needs the signed transaction object as JSON (TronGrid REST), ' +
      'which cannot be derived from raw bytes; sign with the TRON builder and ' +
      'broadcast the object itself',
  );
}

/** Renders a signed payload as `0x`-prefixed hex. */
function toHexPayload(serialized: string | Uint8Array): string {
  if (typeof serialized === 'string') {
    return serialized.startsWith('0x') ? serialized : `0x${serialized}`;
  }
  return `0x${Buffer.from(serialized).toString('hex')}`;
}
