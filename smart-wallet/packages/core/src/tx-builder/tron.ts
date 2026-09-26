import { isTronAddress, tronToHex } from '@chains/address';
import { resolveRpcUrls } from '@chains/registry';
import { postJson, withFallback } from '@chains/transport';
import type { ChainConnector, FeeEstimate, Network } from '@chains';
import {
  BuilderError,
  connectorOf,
  requireAmount,
  requireDecimals,
  resolveNetwork,
  unestimatedFee,
  type BuildTxOptions,
  type TronTxParams,
  type UnsignedTx,
} from './types';

/** TronGrid paths used while building (no signing happens here). */
const PATHS = {
  createTransaction: '/wallet/createtransaction',
  triggerSmartContract: '/wallet/triggersmartcontract',
} as const;

/** Fee limit floor for TRC-20 transfers, in sun (100 TRX). */
const TRC20_MIN_FEE_LIMIT = 100_000_000n;

/**
 * Builds an unsigned TRON transaction through TronGrid's REST API.
 *
 * Native transfers call `/wallet/createtransaction`; TRC-20 transfers call
 * `/wallet/triggersmartcontract` with the `transfer(address,uint256)`
 * selector. Both return the unsigned transaction object (txID + raw data),
 * which is what the signing phase has to sign, so it is kept verbatim in
 * `serialized` and its id in `meta.txID`.
 */
export async function buildTronTx(
  params: TronTxParams,
  options: BuildTxOptions = {},
): Promise<UnsignedTx> {
  const warnings: string[] = [];
  // Base58 addresses are kept for `meta`, hex (`0x41…`) is what TronGrid wants.
  const fromAddress = requireTronAddress(params.from, 'from');
  const toAddress = requireTronAddress(params.to, 'to');
  const from = tronToHex(fromAddress);
  const to = tronToHex(toAddress);
  const amount = requireAmount(params.amount);
  requireSafeInteger(amount, 'amount');

  const token =
    params.token === undefined
      ? undefined
      : {
          address: requireTronAddress(params.token.address, 'token.address'),
          decimals: requireDecimals(params.token.decimals),
        };

  const network: Network = resolveNetwork(params.network);
  const connector = connectorOf(params, options);
  const fee =
    connector === undefined
      ? unestimatedFee('tron', params.chainId, network)
      : await priceWithConnector(connector, {
          from: fromAddress,
          to: toAddress,
          amount,
          token: token?.address,
        });
  if (connector === undefined) {
    warnings.push('no connector supplied: fee fields are zero, estimate the fee before signing');
  }

  const feeLimit = options.feeLimit ?? defaultFeeLimit(fee);
  const endpoints = tronEndpoints(params.chainId, network, options);

  const response =
    token === undefined
      ? await postTron(
          params.chainId,
          endpoints,
          PATHS.createTransaction,
          {
            owner_address: from,
            to_address: to,
            amount: Number(amount),
          },
          options,
        )
      : await postTron(
          params.chainId,
          endpoints,
          PATHS.triggerSmartContract,
          {
            owner_address: from,
            contract_address: tronToHex(token.address),
            function_selector: 'transfer(address,uint256)',
            parameter: `${addressParam(to)}${uint256Param(amount)}`,
            fee_limit: Number(feeLimit),
          },
          options,
        );

  const transaction = readTransaction(response, params.chainId);
  const txID = typeof transaction.txID === 'string' ? transaction.txID : '';
  if (txID === '') {
    throw new BuilderError(`TronGrid did not return a txID for ${params.chainId}`);
  }

  return {
    family: 'tron',
    chainId: params.chainId,
    network,
    serialized: new TextEncoder().encode(JSON.stringify(transaction)),
    fee,
    meta: {
      txID,
      rawDataHex: typeof transaction.raw_data_hex === 'string' ? transaction.raw_data_hex : null,
      from: fromAddress,
      to: toAddress,
      amount: amount.toString(),
      token: token?.address ?? null,
      feeLimit: feeLimit.toString(),
      endpoints: [...endpoints],
      feeEstimated: connector !== undefined,
      warnings,
    },
  };
}

/** Validates a TRON base58 address, returning it unchanged. */
export function requireTronAddress(address: string, field: string): string {
  if (!isTronAddress(address)) {
    throw new BuilderError(`invalid TRON address for ${field}: ${address}`);
  }
  return address;
}

/** Endpoint list for the TRON builder: caller override, then the P3 registry. */
export function tronEndpoints(
  chainId: string,
  network: Network,
  options: BuildTxOptions,
): readonly string[] {
  if (options.rpcUrls !== undefined && options.rpcUrls.length > 0) {
    return options.rpcUrls;
  }
  if (chainId !== 'tron') {
    throw new BuilderError(
      `no RPC endpoints for TRON chain "${chainId}": pass rpcUrls in the build options`,
    );
  }
  return resolveRpcUrls('tron', { network });
}

/** ABI-encodes an address as a 32-byte word, in the `0x41…` hex form. */
export function addressParam(hexAddress: string): string {
  return hexAddress.replace(/^0x/, '').padStart(64, '0');
}

/** ABI-encodes a uint256 as a 32-byte word. */
export function uint256Param(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** Posts to TronGrid with the shared retry/fallback policy from P3. */
async function postTron(
  chainId: string,
  endpoints: readonly string[],
  path: string,
  body: unknown,
  options: BuildTxOptions,
): Promise<unknown> {
  try {
    return await withFallback(
      chainId,
      endpoints,
      (endpoint) => postJson(chainId, endpoint, path, body, options.retry?.timeoutMs ?? 10_000),
      options.retry,
    );
  } catch (error) {
    throw new BuilderError(`TronGrid request to ${path} failed: ${(error as Error).message}`);
  }
}

/** Extracts the transaction object from either TronGrid response shape. */
function readTransaction(response: unknown, chainId: string): Record<string, unknown> {
  const record = asRecord(response);
  const result = asRecord(record.result);
  if (Object.keys(result).length > 0 && result.result !== true) {
    const code = typeof result.code === 'string' ? result.code : 'unknown';
    const message =
      typeof result.message === 'string' ? Buffer.from(result.message, 'hex').toString('utf8') : '';
    throw new BuilderError(`TronGrid rejected the transaction: ${code} ${message}`.trim());
  }

  // `createtransaction` returns the transaction at the top level, while
  // `triggersmartcontract` nests it under `transaction`.
  const nested = asRecord(record.transaction);
  const transaction = Object.keys(nested).length > 0 ? nested : record;
  if (typeof transaction.txID !== 'string' || transaction.txID === '') {
    throw new BuilderError(`TronGrid returned no transaction for ${chainId}`);
  }
  return transaction;
}

/** Fee limit floor: never below the constant-call floor, never below the estimate. */
function defaultFeeLimit(fee: FeeEstimate): bigint {
  return fee.maxCost > TRC20_MIN_FEE_LIMIT ? fee.maxCost : TRC20_MIN_FEE_LIMIT;
}

/** Prices the transaction through a P3 connector. */
async function priceWithConnector(
  connector: ChainConnector,
  request: { from: string; to: string; amount: bigint; token?: string },
): Promise<FeeEstimate> {
  try {
    return await connector.estimateFee({
      from: request.from,
      to: request.to,
      amount: request.amount,
      token: request.token,
    });
  } catch (error) {
    throw new BuilderError(
      `fee estimation failed on ${connector.chainId}: ${(error as Error).message}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function requireSafeInteger(value: bigint, field: string): void {
  if (value > MAX_SAFE_INTEGER_BIGINT) {
    throw new BuilderError(`${field} ${value} exceeds the safe integer range of JSON numbers`);
  }
}

const MAX_SAFE_INTEGER_BIGINT = 9_007_199_254_740_991n;
