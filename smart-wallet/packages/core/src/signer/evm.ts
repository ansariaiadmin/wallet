import { privateKeyToAccount } from 'viem/accounts';
import {
  hexToBytes,
  isAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
} from 'viem';
import {
  asSignerError,
  metaString,
  requirePrivateKey,
  requireUnsignedTx,
  toHexPayload,
  zeroIfBuffer,
  type SignInput,
  type SignedTx,
  SignerError,
} from './types';

/**
 * Signs an unsigned EIP-1559 transaction with viem.
 *
 * The serialized payload from P4 is parsed back, signed through viem's local
 * account implementation (the same code path `viem/actions` `signTransaction`
 * delegates to for local accounts — it signs with secp256k1 through
 * `@noble/curves`, no ethers and no JSON-RPC call) and the transaction hash is
 * `keccak256` of the signed RLP bytes.
 *
 * The key buffer is zeroed in `finally`, so it is wiped whether signing
 * succeeds or throws.
 */
export async function signEvmTx(input: SignInput): Promise<SignedTx> {
  const key = input.privateKey;
  try {
    const family = requireUnsignedTx(input.unsignedTx);
    if (family !== 'evm') {
      throw new SignerError(
        'UNSUPPORTED_FAMILY',
        `EVM signer cannot sign a "${family}" transaction`,
      );
    }
    requirePrivateKey(key, [32], 'evm');

    const unsigned = parseTransaction(toHexPayload(input.unsignedTx.serialized));
    if (unsigned.type !== 'eip1559') {
      throw new SignerError(
        'SIGN_FAILED',
        `only EIP-1559 transactions are supported, received ${String(unsigned.type)}`,
      );
    }

    const account = privateKeyToAccount(`0x${Buffer.from(key).toString('hex')}`);
    const signed = await account.signTransaction(unsigned);
    const txHash = keccak256(signed);
    // EIP-1559 serialization always starts with the 0x02 type byte.
    const from = await recoverTransactionAddress({
      serializedTransaction: signed as `0x02${string}`,
    });

    const expectedFrom = metaString(input.unsignedTx.meta, 'from');
    const warnings: string[] = [];
    if (expectedFrom !== null && !isAddress(expectedFrom)) {
      warnings.push(`unsignedTx.meta.from is not an EVM address: ${expectedFrom}`);
    } else if (expectedFrom !== null && expectedFrom.toLowerCase() !== from.toLowerCase()) {
      warnings.push(`key signs as ${from} but the transaction was built for ${expectedFrom}`);
    }

    return {
      family: 'evm',
      chainId: input.unsignedTx.chainId,
      network: input.unsignedTx.network,
      serialized: hexToBytes(signed),
      txHash,
      meta: {
        from,
        to: metaString(input.unsignedTx.meta, 'to'),
        nonce: metaString(input.unsignedTx.meta, 'nonce'),
        gas: metaString(input.unsignedTx.meta, 'gas'),
        maxFeePerGas: metaString(input.unsignedTx.meta, 'maxFeePerGas'),
        maxPriorityFeePerGas: metaString(input.unsignedTx.meta, 'maxPriorityFeePerGas'),
        type: 'eip1559',
        signatureLength: (signed.length - 2) / 2,
        warnings,
      },
    };
  } catch (error) {
    throw asSignerError('evm', error);
  } finally {
    zeroIfBuffer(key);
  }
}
