import { encodeFunctionData, erc20Abi, hexToBytes, isAddress, serializeTransaction } from 'viem';
import type { TransactionSerializableEIP1559 } from 'viem';
import type { ChainConnector, FeeEstimate } from '@chains';
import {
  BuilderError,
  connectorOf,
  requireAmount,
  requireDecimals,
  resolveNetwork,
  unestimatedFee,
  type BuildTxOptions,
  type EvmTxParams,
  type UnsignedTx,
} from './types';

/**
 * Numeric chain ids used for the EIP-1559 envelope. Chains that are not listed
 * (or custom networks) build with chain id 0 and a warning, because a wrong
 * replay-protection id is worse than an obviously unfinished transaction.
 */
const EVM_CHAIN_IDS: Readonly<Record<string, number>> = {
  ethereum: 1,
  mainnet: 1,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  bsc: 56,
  sepolia: 11_155_111,
  amoy: 80_002,
  basesepolia: 84_532,
  'base-sepolia': 84_532,
  arbitrumsepolia: 421_614,
  'arbitrum-sepolia': 421_614,
  optimismsepolia: 11_155_420,
  'optimism-sepolia': 11_155_420,
  bsctestnet: 97,
  'bsc-testnet': 97,
};

/**
 * Builds an unsigned EIP-1559 transaction.
 *
 * Native transfers carry `value`; token transfers encode `transfer(address,
 * uint256)` calldata and send `value: 0` to the token contract. Nonce, gas and
 * the fee come from `options`/the connector; anything missing stays at a
 * placeholder value and is listed in `meta.warnings`.
 */
export async function buildEvmTx(
  params: EvmTxParams,
  options: BuildTxOptions = {},
): Promise<UnsignedTx> {
  const warnings: string[] = [];
  const from = requireEvmAddress(params.from, 'from');
  const to = requireEvmAddress(params.to, 'to');
  const amount = requireAmount(params.amount);

  const token =
    params.token === undefined
      ? undefined
      : {
          address: requireEvmAddress(params.token.address, 'token.address'),
          decimals: requireDecimals(params.token.decimals),
        };

  const data: `0x${string}` | undefined =
    token === undefined
      ? undefined
      : encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [to, amount],
        });
  const target = token?.address ?? to;
  const value = token === undefined ? amount : 0n;

  const network = resolveNetwork(params.network);
  const connector = connectorOf(params, options);
  const fee =
    connector === undefined
      ? unestimatedFee('evm', params.chainId, network)
      : await priceWithConnector(connector, {
          from,
          to: target,
          amount,
          data,
          token: token?.address,
        });

  const gasLimit = BigInt(fee.units);
  const maxFeePerGas = BigInt(fee.unitPrice);
  const maxPriorityFeePerGas = options.maxPriorityFeePerGas ?? 0n;
  const nonce = options.nonce ?? 0n;
  const chainId = options.evmChainId ?? EVM_CHAIN_IDS[params.chainId.toLowerCase()];

  if (connector === undefined) {
    warnings.push('no connector supplied: fee fields are zero, estimate the fee before signing');
  }
  if (connector !== undefined && connector.chainId !== params.chainId) {
    warnings.push(
      `connector is bound to "${connector.chainId}" but the request is for "${params.chainId}"`,
    );
  }
  if (options.nonce === undefined) {
    warnings.push('nonce not supplied: built with nonce 0, fetch the account nonce before signing');
  }
  if (options.maxPriorityFeePerGas === undefined) {
    warnings.push('priority fee not supplied: built with a 0 tip');
  }
  if (chainId === undefined) {
    // Without the replay-protection chain id the envelope cannot be built at
    // all, and guessing one would produce a transaction that is valid on the
    // wrong network.
    throw new BuilderError(
      `unknown numeric chain id for "${params.chainId}": pass evmChainId in the build options`,
    );
  }
  if (nonce > MAX_SAFE_NONCE) {
    throw new BuilderError(`nonce ${nonce} exceeds the safe integer range`);
  }

  const transaction: TransactionSerializableEIP1559 = {
    chainId,
    nonce: Number(nonce),
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    to: target,
    value,
    data,
    type: 'eip1559',
  };

  return {
    family: 'evm',
    chainId: params.chainId,
    network,
    serialized: hexToBytes(serializeTransaction(transaction)),
    fee,
    meta: {
      type: 'eip1559',
      chainId: chainId.toString(),
      nonce: nonce.toString(),
      gas: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      from,
      to: target,
      value: value.toString(),
      data: data ?? null,
      token: token?.address ?? null,
      feeEstimated: connector !== undefined,
      warnings,
    },
  };
}

/** Validates an EVM address, keeping its checksummed form for display. */
export function requireEvmAddress(address: string, field: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new BuilderError(`invalid EVM address for ${field}: ${address}`);
  }
  return address;
}

/** Prices the transaction through a P3 connector. */
async function priceWithConnector(
  connector: ChainConnector,
  request: { from: string; to: string; amount: bigint; data?: string; token?: string },
): Promise<FeeEstimate> {
  try {
    return await connector.estimateFee({
      from: request.from,
      to: request.to,
      amount: request.token === undefined ? request.amount : undefined,
      token: request.token,
      data: request.data,
    });
  } catch (error) {
    throw new BuilderError(
      `fee estimation failed on ${connector.chainId}: ${(error as Error).message}`,
    );
  }
}

const MAX_SAFE_NONCE = 9_007_199_254_740_991n;
