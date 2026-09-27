import { BuilderError, OracleError, RiskError, SignerError } from '@wallet/core';
import { KeyStoreError, type KeyStoreErrorCode } from '@wallet/keys';
import { BroadcastError, ChainError } from '@wallet/chains';
import { RouterError } from '@wallet/router';

/**
 * Every error the SDK raises.
 *
 * Upstream failures from the core, chains and router packages are translated
 * into an `SdkError` carrying a stable `code`, so a caller only ever has to
 * switch on one error type. Anything unrecognised becomes `INTERNAL`.
 */
export class SdkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SdkError';
  }
}

/**
 * Translates a thrown value into an {@link SdkError}.
 *
 * The mapping is ordered from the most specific upstream class to the most
 * generic, and every mapping keeps the original error as `cause` so the
 * details are still available for logging without leaking to the caller.
 */
export function toSdkError(error: unknown, fallbackCode = 'INTERNAL'): SdkError {
  if (error instanceof SdkError) {
    return error;
  }
  if (error instanceof OracleError) {
    return new SdkError(error.code, error.message, { cause: error });
  }
  if (error instanceof RiskError) {
    return new SdkError(error.code, error.message, { cause: error });
  }
  if (error instanceof RouterError) {
    return new SdkError(error.code, error.message, { cause: error });
  }
  if (error instanceof SignerError) {
    return new SdkError(error.code, error.message, { cause: error });
  }
  if (error instanceof BuilderError) {
    return new SdkError('BUILD_FAILED', error.message, { cause: error });
  }
  if (error instanceof BroadcastError) {
    return new SdkError('BROADCAST_FAILED', error.message, { cause: error });
  }
  if (error instanceof ChainError) {
    return new SdkError('CHAIN_ERROR', error.message, { cause: error });
  }
  if (error instanceof KeyStoreError) {
    return new SdkError(keystoreCode(error.code), error.message, { cause: error });
  }
  if (error instanceof Error) {
    return new SdkError(fallbackCode, error.message, { cause: error });
  }
  return new SdkError(fallbackCode, String(error), { cause: error });
}

/**
 * Maps a `@wallet/keys` error code onto the sdk's.
 *
 * The two packages share one taxonomy: `INVALID_MNEMONIC` is the same word on
 * both sides, and a wrong password is a locked wallet rather than a keystore
 * failure. Only the codes the sdk cannot express fall back to `KEYSTORE_ERROR`.
 */
function keystoreCode(code: KeyStoreErrorCode): string {
  switch (code) {
    case 'INVALID_MNEMONIC':
      return 'INVALID_MNEMONIC';
    case 'WRONG_PASSWORD':
    case 'LOCKED':
      return 'LOCKED';
    default:
      return 'KEYSTORE_ERROR';
  }
}
