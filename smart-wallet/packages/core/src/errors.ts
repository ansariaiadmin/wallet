/** Base class for every error raised by the smart-wallet core. */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when two amounts with different currencies are combined. */
export class CurrencyMismatchError extends WalletError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`Cannot combine amounts in different currencies: ${left} vs ${right}`);
  }
}
