import { Keypair, Transaction } from '@solana/web3.js';
import { base58 } from '@scure/base';
import {
  asSignerError,
  metaString,
  requirePrivateKey,
  requireUnsignedTx,
  toBytesPayload,
  zeroIfBuffer,
  type SignInput,
  type SignedTx,
  SignerError,
} from './types';

/**
 * Signs an unsigned Solana transaction with `@solana/web3.js`.
 *
 * The serialized payload from P4 is deserialized, signed with the ed25519
 * keypair and re-serialized with every signature present. The transaction hash
 * is the base58 encoding of the first signature, which is what Solana
 * explorers and `sendTransaction` use as the transaction id.
 *
 * The key buffer is zeroed in `finally`, so it is wiped whether signing
 * succeeds or throws.
 */
export async function signSolanaTx(input: SignInput): Promise<SignedTx> {
  const key = input.privateKey;
  try {
    const family = requireUnsignedTx(input.unsignedTx);
    if (family !== 'solana') {
      throw new SignerError(
        'UNSUPPORTED_FAMILY',
        `SOLANA signer cannot sign a "${family}" transaction`,
      );
    }
    requirePrivateKey(key, [32, 64], 'solana');

    const transaction = Transaction.from(toBytesPayload(input.unsignedTx.serialized));
    const keypair = keypairFrom(key);

    // `sign()` also refuses keys that are not a required signer of the
    // transaction, which keeps a wrong key from producing an unusable payload.
    transaction.sign(keypair);

    const signature = transaction.signatures[0]?.signature;
    if (signature === undefined || signature === null || signature.length === 0) {
      throw new SignerError('SIGN_FAILED', 'no signature was produced for the transaction');
    }

    const signer = keypair.publicKey.toBase58();
    const feePayer = transaction.feePayer?.toBase58() ?? null;
    const warnings: string[] = [];
    const expectedFrom = metaString(input.unsignedTx.meta, 'from');
    if (feePayer !== null && feePayer !== signer) {
      warnings.push(`fee payer ${feePayer} differs from the signing key ${signer}`);
    }
    if (expectedFrom !== null && expectedFrom !== signer) {
      warnings.push(`key signs as ${signer} but the transaction was built for ${expectedFrom}`);
    }

    return {
      family: 'solana',
      chainId: input.unsignedTx.chainId,
      network: input.unsignedTx.network,
      serialized: transaction.serialize({ requireAllSignatures: true }),
      txHash: base58.encode(signature),
      meta: {
        from: signer,
        feePayer,
        signatureCount: transaction.signatures.length,
        recentBlockhash: transaction.recentBlockhash,
        warnings,
      },
    };
  } catch (error) {
    throw asSignerError('solana', error);
  } finally {
    zeroIfBuffer(key);
  }
}

/**
 * Builds a keypair from the secret bytes: 64 bytes are used as the full
 * secret key, 32 bytes are treated as the ed25519 seed.
 */
export function keypairFrom(privateKey: Uint8Array): Keypair {
  if (privateKey.length === 64) {
    return Keypair.fromSecretKey(privateKey);
  }
  return Keypair.fromSeed(privateKey);
}
