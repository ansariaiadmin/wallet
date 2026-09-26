import { Hono } from 'hono';
import { buildTx, BuilderError } from '@wallet/core';
import type { ContractToken, SplToken, TxParams } from '@wallet/core';
import { ApiError } from '../errors';
import { FAMILY_CHAIN_ID } from '../chains';
import { jsonSafe } from '../serialize';
import { optionalString, readJsonObject, requireString } from '../request';
import { isChainType, isDecimals, isPositiveNumberString, isTxType } from '../validation';

/** Network every built transaction targets unless a caller overrides it. */
const DEFAULT_NETWORK = 'mainnet';

/**
 * Build endpoint backed by the P4 builder.
 *
 * `POST /tx/build` returns an unsigned transaction, never a signed one: the
 * payload is handed back for the caller to sign with the P5 signer.
 *
 * Field level problems (missing `to`, a token build without `tokenAddress`) are
 * 400; anything the builder itself rejects (a malformed address, decimals out
 * of range, a chain that needs RPC endpoints the API does not have) is 422.
 */
export function txRoutes(): Hono {
  return new Hono().post('/tx/build', async (c) => {
    const body = await readJsonObject(c);

    const chain = body.chain;
    if (!isChainType(chain)) {
      throw new ApiError(400, 'INVALID_CHAIN', 'chain must be one of: evm, solana, tron');
    }
    const type = body.type;
    if (!isTxType(type)) {
      throw new ApiError(400, 'INVALID_TX_TYPE', 'type must be one of: native, token');
    }

    const from = requireString(body, 'from');
    const to = requireString(body, 'to');
    const amount = body.amount;
    if (!isPositiveNumberString(amount)) {
      throw new ApiError(
        400,
        'INVALID_AMOUNT',
        'amount must be a positive integer string in the smallest token unit',
      );
    }
    const network = optionalString(body, 'network') ?? DEFAULT_NETWORK;

    let token: ContractToken | SplToken | undefined;
    if (type === 'token') {
      const tokenAddress = requireString(body, 'tokenAddress');
      const decimals = body.decimals;
      if (!isDecimals(decimals)) {
        throw new ApiError(
          400,
          'INVALID_DECIMALS',
          'decimals must be an integer between 0 and 255 when type is token',
        );
      }
      token =
        chain === 'solana' ? { mint: tokenAddress, decimals } : { address: tokenAddress, decimals };
    }

    const params: TxParams =
      chain === 'solana'
        ? {
            family: 'solana',
            chainId: FAMILY_CHAIN_ID.solana,
            network,
            from,
            to,
            amount: BigInt(amount),
            token: token as SplToken | undefined,
          }
        : {
            family: chain,
            chainId: FAMILY_CHAIN_ID[chain],
            network,
            from,
            to,
            amount: BigInt(amount),
            token: token as ContractToken | undefined,
          };

    let unsigned;
    try {
      unsigned = await buildTx(params);
    } catch (error) {
      if (error instanceof BuilderError) {
        throw new ApiError(422, 'BUILD_FAILED', error.message);
      }
      throw error;
    }

    return c.json({ chain, unsignedTx: jsonSafe(unsigned) }, 200);
  });
}
