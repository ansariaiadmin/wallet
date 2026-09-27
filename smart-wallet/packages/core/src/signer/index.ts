import { signEvmTx } from './evm';
import { signSolanaTx } from './solana';
import { signTronTx } from './tron';
import {
  requireUnsignedTx,
  zeroIfBuffer,
  type SignInput,
  type SignedTx,
  SignerError,
} from './types';

export * from './evm';
export * from './solana';
export * from './tron';
export * from './types';

/**
 * Signs an unsigned transaction from the P4 builder on any supported family.
 *
 * No private key ever leaves this function: it is only read to produce the
 * signature and is zeroed in `finally` — by the family signer and again here,
 * so the guarantee holds even if a future signer forgets it.
 */
export async function sign(input: SignInput): Promise<SignedTx> {
  const family = requireUnsignedTx(input?.unsignedTx);
  const key = input.privateKey;

  try {
    switch (family) {
      case 'evm':
        return await signEvmTx(input);
      case 'solana':
        return await signSolanaTx(input);
      case 'tron':
        return await signTronTx(input);
      default:
        throw new SignerError('UNSUPPORTED_FAMILY', `unsupported transaction family: ${family}`);
    }
  } finally {
    zeroIfBuffer(key);
  }
}
