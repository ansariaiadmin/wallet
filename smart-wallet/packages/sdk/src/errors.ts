import {
  BuilderError,
  InvalidMnemonicError,
  InvalidPasswordError,
  KeystoreError,
  MalformedKeystoreError,
  OracleError,
  RiskError,
  SignerError,
} from '@wallet/core';
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
  if (error instanceof InvalidMnemonicError) {
    return new SdkError('INVALID_MNEMONIC', error.message, { cause: error });
  }
  if (error instanceof InvalidPasswordError || error instanceof MalformedKeystoreError) {
    return new SdkError('LOCKED', 'wrong password or corrupted keystore', { cause: error });
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
  if (error instanceof KeystoreError) {
    return new SdkError('KEYSTORE_ERROR', error.message, { cause: error });
  }
  if (error instanceof Error) {
    return new SdkError(fallbackCode, error.message, { cause: error });
  }
  return new SdkError(fallbackCode, String(error), { cause: error });
}
