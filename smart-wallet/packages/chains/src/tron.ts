import { BroadcastError, InvalidAddressError, RpcError } from './errors';
import { formatUnits } from './format';
import { tronToHex } from './address';
import { postJson, rpcReason, withFallback, withTimeout } from './transport';
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

/** TRON REST paths (TronGrid full-node HTTP API). */
const PATHS = {
  getAccount: '/wallet/getaccount',
  triggerConstantContract: '/wallet/triggerconstantcontract',
  chainParameters: '/wallet/getchainparameters',
  broadcast: '/wallet/broadcasttransaction',
} as const;

/** Bandwidth a plain TRX transfer consumes. */
const TRX_TRANSFER_BANDWIDTH = 265n;
/** Bandwidth a TRC-20 transfer consumes (calldata + base). */
const TRC20_TRANSFER_BANDWIDTH = 345n;
/** TRX burned when free bandwidth cannot cover the transaction. */
const BANDWIDTH_BURN_SUN = 100_000n;
/** Fallback energy price (sun per energy unit) when chain params are unavailable. */
const DEFAULT_ENERGY_PRICE_SUN = 420n;

/** Outcome of a `triggerconstantcontract` call. */
interface ConstantCallResult {
  /** First returned word, hex encoded (empty for void functions). */
  readonly value: string | null;
  /** Energy the real transaction would consume. */
  readonly energyUsed: bigint;
}

/** TRON connector speaking the TronGrid REST API. */
export class TronConnector implements ChainConnector {
  constructor(
    private readonly definition: ChainDefinition,
    private readonly activeNetwork: Network,
    private readonly rpcUrls: readonly string[],
    private readonly retry?: RetryOptions,
  ) {}

  get chainId(): 'tron' {
    return 'tron';
  }

  get network(): Network {
    return this.activeNetwork;
  }

  async getNativeBalance(address: string): Promise<Balance> {
    const hexAddress = this.requireAddress(address);
    const account = await this.post(PATHS.getAccount, { address: hexAddress, visible: false });
    const balance = readBigInt(account, 'balance') ?? 0n;

    return {
      chainId: 'tron',
      network: this.activeNetwork,
      address,
      unit: 'native',
      symbol: this.definition.nativeCurrency.symbol,
      decimals: this.definition.nativeCurrency.decimals,
      amount: balance,
      formatted: formatUnits(balance, 6),
    };
  }

  async getTokenBalances(address: string, tokens?: readonly string[]): Promise<readonly Balance[]> {
    const hexAddress = this.requireAddress(address);
    const requested = tokens ?? [];
    const balances: Balance[] = [];

    for (const token of requested) {
      const hexToken = this.requireAddress(token);
      const [balanceCall, decimalsCall, symbolCall] = await Promise.all([
        this.callContract(hexAddress, hexToken, 'balanceOf(address)', addressParam(hexAddress)),
        this.callContract(hexAddress, hexToken, 'decimals()', ''),
        this.callContract(hexAddress, hexToken, 'symbol()', ''),
      ]);

      const decimals = Number(hexToBigInt(decimalsCall.value ?? '0x0'));
      const amount = hexToBigInt(balanceCall.value ?? '0x0');
      balances.push({
        chainId: 'tron',
        network: this.activeNetwork,
        address,
        unit: 'token',
        symbol: decodeTronString(symbolCall.value ?? '') ?? 'UNKNOWN',
        decimals,
        amount,
        formatted: formatUnits(amount, decimals),
        tokenAddress: token,
      });
    }
    return balances;
  }

  async estimateFee(request: FeeRequest): Promise<FeeEstimate> {
    const hexFrom = this.requireAddress(request.from);

    if (request.token === undefined) {
      const account = await this.post(PATHS.getAccount, { address: hexFrom, visible: false });
      const availableBandwidth =
        (readBigInt(account, 'free_net_limit') ?? 0n) + (readBigInt(account, 'net_limit') ?? 0n);
      const bandwidthCost = availableBandwidth >= TRX_TRANSFER_BANDWIDTH ? 0n : BANDWIDTH_BURN_SUN;

      return {
        chainId: 'tron',
        network: this.activeNetwork,
        nativeSymbol: this.definition.nativeCurrency.symbol,
        nativeDecimals: this.definition.nativeCurrency.decimals,
        units: TRX_TRANSFER_BANDWIDTH,
        unitPrice: bandwidthCost === 0n ? 0n : bandwidthCost / TRX_TRANSFER_BANDWIDTH,
        maxCost: bandwidthCost,
        formattedMaxCost: formatUnits(bandwidthCost, 6),
        details: {
          availableBandwidth: availableBandwidth.toString(),
          bandwidthNeeded: TRX_TRANSFER_BANDWIDTH.toString(),
          energyUsed: '0',
          energyPriceSun: '0',
          note: 'bandwidth model; staked bandwidth is not counted',
        },
      };
    }

    const hexTo = this.requireAddress(request.to);
    const hexToken = this.requireAddress(request.token);
    const [transferCall, energyPrice] = await Promise.all([
      this.callContract(
        hexFrom,
        hexToken,
        'transfer(address,uint256)',
        `${addressParam(hexTo)}${uint256Param(request.amount ?? 0n)}`,
      ),
      this.energyPriceSun(),
    ]);

    const energyCost = transferCall.energyUsed * energyPrice;
    const maxCost = BANDWIDTH_BURN_SUN + energyCost;

    return {
      chainId: 'tron',
      network: this.activeNetwork,
      nativeSymbol: this.definition.nativeCurrency.symbol,
      nativeDecimals: this.definition.nativeCurrency.decimals,
      units: TRC20_TRANSFER_BANDWIDTH,
      unitPrice: energyPrice,
      maxCost,
      formattedMaxCost: formatUnits(maxCost, 6),
      details: {
        bandwidthNeeded: TRC20_TRANSFER_BANDWIDTH.toString(),
        bandwidthBurnSun: BANDWIDTH_BURN_SUN.toString(),
        energyUsed: transferCall.energyUsed.toString(),
        energyPriceSun: energyPrice.toString(),
      },
    };
  }

  async broadcast(signedTransaction: string): Promise<BroadcastResult> {
    // TRON broadcasts a signed transaction object, not raw bytes.
    let transaction: unknown;
    try {
      transaction = JSON.parse(signedTransaction) as unknown;
    } catch (error) {
      throw new BroadcastError(
        'tron',
        'signed transaction must be a JSON string of the signed transaction object',
        error,
      );
    }

    let response: Record<string, unknown>;
    try {
      response = (await this.post(PATHS.broadcast, { transaction })) as Record<string, unknown>;
    } catch (error) {
      throw new BroadcastError('tron', `Broadcast rejected: ${rpcReason(error)}`, error);
    }
    const result = response.result as
      { result?: boolean; code?: string; message?: string } | undefined;
    const txid = typeof response.txid === 'string' ? response.txid : undefined;

    if (result?.result !== true || txid === undefined) {
      const code = result?.code ?? 'unknown';
      const message =
        typeof result?.message === 'string'
          ? Buffer.from(result.message, 'hex').toString('utf8')
          : '';
      throw new BroadcastError('tron', `node rejected the transaction: ${code} ${message}`.trim());
    }

    return {
      chainId: 'tron',
      network: this.activeNetwork,
      txHash: txid,
      explorerUrl: `${this.explorerBase()}/#/transaction/${txid}`,
    };
  }

  /** Runs a `triggerconstantcontract` call and returns its result word + energy. */
  private async callContract(
    ownerHex: string,
    contractHex: string,
    selector: string,
    parameter: string,
  ): Promise<ConstantCallResult> {
    const response = (await this.post(PATHS.triggerConstantContract, {
      owner_address: ownerHex,
      contract_address: contractHex,
      function_selector: selector,
      parameter,
      visible: false,
    })) as {
      constant_result?: string[];
      energy_used?: number;
      result?: { result?: boolean; code?: string; message?: string };
    };

    if (response.result?.result !== true) {
      const code = response.result?.code ?? 'unknown';
      const message =
        typeof response.result?.message === 'string'
          ? Buffer.from(response.result.message, 'hex').toString('utf8')
          : '';
      throw new RpcError(
        'tron',
        'constant call',
        `constant call failed: ${code} ${message}`.trim(),
      );
    }

    return {
      value: response.constant_result?.[0] ?? null,
      energyUsed: BigInt(response.energy_used ?? 0),
    };
  }

  private async energyPriceSun(): Promise<bigint> {
    try {
      const response = (await this.post(PATHS.chainParameters, {})) as {
        chainParameter?: { key: string; value?: number }[];
      };
      const entry = response.chainParameter?.find((parameter) => parameter.key === 'getEnergyFee');
      return entry?.value === undefined ? DEFAULT_ENERGY_PRICE_SUN : BigInt(entry.value);
    } catch {
      return DEFAULT_ENERGY_PRICE_SUN;
    }
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return withFallback(
      'tron',
      this.rpcUrls,
      (endpoint) =>
        withTimeout(
          postJson('tron', endpoint, path, body, this.retry?.timeoutMs ?? 10_000),
          this.retry?.timeoutMs ?? 10_000,
          'tron',
          endpoint,
        ),
      this.retry,
    );
  }

  private explorerBase(): string {
    return this.activeNetwork === 'testnet'
      ? (this.definition.testnetExplorerUrl ?? this.definition.explorerUrl)
      : this.definition.explorerUrl;
  }

  private requireAddress(address: string): string {
    try {
      return tronToHex(address);
    } catch {
      throw new InvalidAddressError('tron', address);
    }
  }
}

/** ABI-encodes a TRON address as a 32-byte word (20 bytes, left padded). */
function addressParam(hexAddress: string): string {
  return hexAddress.replace(/^0x/, '').padStart(64, '0');
}

/** ABI-encodes a uint256 as a 32-byte word. */
function uint256Param(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** Decodes a hex word (with or without `0x`) into a bigint. */
export function hexToBigInt(hex: string): bigint {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  return normalized.length === 0 ? 0n : BigInt(`0x${normalized}`);
}

/** Decodes an ABI string return value (`offset,length,data`) or bytes32 ASCII. */
export function decodeTronString(hex: string): string | null {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (normalized.length < 64 || normalized.length % 64 !== 0) return null;

  try {
    if (normalized.length >= 128) {
      const offset = Number(BigInt(`0x${normalized.slice(0, 64)}`)) * 2;
      const length = Number(BigInt(`0x${normalized.slice(offset, offset + 64)}`));
      if (length > 0 && offset + 64 + length * 2 <= normalized.length) {
        const text = Buffer.from(
          normalized.slice(offset + 64, offset + 64 + length * 2),
          'hex',
        ).toString('utf8');
        if (/^[\x20-\x7e]+$/.test(text)) return text;
      }
    }
  } catch {
    // fall through to the bytes32 interpretation
  }

  const text = Buffer.from(normalized.slice(0, 64), 'hex').toString('utf8').replace(/\0+$/, '');
  return /^[\x20-\x7e]+$/.test(text) && text.length > 0 ? text : null;
}

function readBigInt(source: unknown, key: string): bigint | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}
