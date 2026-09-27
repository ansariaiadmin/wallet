/** Base class for every connector error. */
export class ChainError extends Error {
  constructor(
    readonly chainId: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A single RPC endpoint failed. */
export class RpcError extends ChainError {
  constructor(
    chainId: string,
    readonly endpoint: string,
    message: string,
    cause?: unknown,
  ) {
    super(chainId, message, cause);
  }
}

/** Every configured endpoint failed after all retries. */
export class AllRpcEndpointsFailedError extends ChainError {
  constructor(
    chainId: string,
    readonly failures: readonly RpcError[],
  ) {
    super(
      chainId,
      `All ${failures.length} RPC endpoint(s) failed: ${failures
        .map((failure) => `${failure.endpoint} (${failure.message})`)
        .join('; ')}`,
    );
  }
}

/** The node refused the signed transaction. */
export class BroadcastError extends ChainError {
  constructor(chainId: string, message: string, cause?: unknown) {
    super(chainId, message, cause);
  }
}

/** The address does not belong to the chain's format. */
export class InvalidAddressError extends ChainError {
  constructor(
    chainId: string,
    readonly address: string,
  ) {
    super(chainId, `Invalid ${chainId} address: ${address}`);
  }
}

/** The chain or network combination is not supported. */
export class UnsupportedChainError extends ChainError {
  constructor(chainId: string) {
    super(chainId, `Unsupported chain: ${chainId}`);
  }
}
