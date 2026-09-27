import { Hono } from 'hono';
import { SmartWallet, toSdkError } from '@wallet/sdk';
import { ApiError } from '../errors';
import { jsonSafe } from '../serialize';
import { readJsonObject, requireString } from '../request';
import { isChainType, isDecimals, isPositiveNumberString, isTxType } from '../validation';

/** The `NetworkId` whose family is `chain`, so the SDK can resolve it. */
const CHAIN_TO_NETWORK = { evm: 'ethereum', solana: 'solana', tron: 'tron' } as const;

/** Reads `decimals` and rejects anything the builder would refuse anyway. */
function readDecimals(body: Record<string, unknown>): number {
  const decimals = body.decimals;
  if (!isDecimals(decimals)) {
    throw new ApiError(
      400,
      'INVALID_DECIMALS',
      'decimals must be an integer between 0 and 255 when type is token',
    );
  }
  return decimals;
}

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

    // The build runs through `SmartWallet.buildUnsigned`, not the core builder
    // directly: this is the one place the api and the sdk both build a
    // transaction, and two implementations of one rule is how they drift.
    // Nothing is signed here and no key material exists in this process.
    let unsigned;
    try {
      unsigned = await new SmartWallet().buildUnsigned({
        network: CHAIN_TO_NETWORK[chain],
        type,
        from,
        to,
        amount,
        tokenAddress: type === 'token' ? requireString(body, 'tokenAddress') : undefined,
        decimals: type === 'token' ? readDecimals(body) : undefined,
      });
    } catch (error) {
      // A field-level problem stays a 400 and a builder refusal stays a 422:
      // the two mean different things to a caller, and the old route kept them
      // apart. Re-throwing an `ApiError` untouched is what stops this catch
      // from flattening a 400 into a 422.
      if (error instanceof ApiError) {
        throw error;
      }
      const sdkError = toSdkError(error, 'BUILD_FAILED');
      if (sdkError.code === 'INVALID_INPUT') {
        throw new ApiError(400, 'INVALID_INPUT', sdkError.message);
      }
      throw new ApiError(422, 'BUILD_FAILED', sdkError.message);
    }

    return c.json({ chain, unsignedTx: jsonSafe(unsigned) }, 200);
  });
}
