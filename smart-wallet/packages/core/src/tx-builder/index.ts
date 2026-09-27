import { buildEvmTx } from './evm';
import { buildSolanaTx } from './solana';
import { buildTronTx } from './tron';
import { BuilderError, type BuildTxOptions, type TxParams, type UnsignedTx } from './types';

export * from './evm';
export * from './solana';
export * from './tron';
export * from './types';

/**
 * Builds an unsigned transaction for any supported family.
 *
 * The result is never signed: `serialized` is the payload the signing phase
 * signs, and `fee` is the P3 estimate used to price it. Missing chain state is
 * reported in `meta.warnings` instead of being silently invented.
 */
export async function buildTx(params: TxParams, options: BuildTxOptions = {}): Promise<UnsignedTx> {
  switch (params.family) {
    case 'evm':
      return buildEvmTx(params, options);
    case 'solana':
      return buildSolanaTx(params, options);
    case 'tron':
      return buildTronTx(params, options);
    default:
      throw new BuilderError(
        `unsupported transaction family: ${JSON.stringify((params as { family?: unknown }).family)}`,
      );
  }
}
