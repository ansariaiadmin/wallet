import { Hono } from 'hono';
import { toSdkError, type SmartWallet } from '@wallet/sdk';
import { ApiError } from '../errors';
import { readJsonObject, requireString, optionalString } from '../request';

/**
 * Screening endpoints backed by the cached P8 heuristic checker.
 *
 * Both routes only validate that the required field is present: the level and
 * the reasons come from the providers, and the merged verdict is returned
 * as-is. An upstream refusal is 400 (invalid input) or 503 (every provider
 * failed), which is what the global handler renders.
 *
 * The verdict comes from `SmartWallet`, so an embedder that screens an address
 * through the sdk gets the same answer this route gives.
 */
export function riskRoutes(wallet: SmartWallet): Hono {
  return new Hono()
    .post('/risk/address', async (c) => {
      const body = await readJsonObject(c);
      const address = requireString(body, 'address');
      const chain = optionalString(body, 'chain');

      let result;
      try {
        result = await wallet.checkAddressRisk(address, chain);
      } catch (error) {
        const sdkError = toSdkError(error, 'INTERNAL');
        if (sdkError.code === 'INVALID_INPUT') {
          throw new ApiError(400, 'INVALID_INPUT', sdkError.message);
        }
        throw new ApiError(503, 'RISK_UNAVAILABLE', sdkError.message);
      }

      return c.json(
        {
          overallRisk: result.overallRisk,
          flags: result.flags,
          assessedAt: result.assessedAt,
        },
        200,
      );
    })
    .post('/risk/token', async (c) => {
      const body = await readJsonObject(c);
      const symbol = requireString(body, 'symbol');
      const chain = optionalString(body, 'chain');

      let result;
      try {
        result = await wallet.checkTokenRisk(symbol, chain);
      } catch (error) {
        const sdkError = toSdkError(error, 'INTERNAL');
        if (sdkError.code === 'INVALID_INPUT') {
          throw new ApiError(400, 'INVALID_INPUT', sdkError.message);
        }
        throw new ApiError(503, 'RISK_UNAVAILABLE', sdkError.message);
      }

      return c.json(
        {
          overallRisk: result.overallRisk,
          flags: result.flags,
          assessedAt: result.assessedAt,
        },
        200,
      );
    });
}
