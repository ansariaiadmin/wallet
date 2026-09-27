import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { tronFromHex } from '@chains/address';
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
 * Signs an unsigned TRON transaction, hand-written on top of `node:crypto` and
 * `@noble/curves` (no tronweb).
 *
 * P4 stores the TronGrid transaction object (`raw_data`, `raw_data_hex`) as
 * JSON bytes. TRON signs `sha256(raw_data_hex bytes)` with secp256k1 — the
 * same digest that is the transaction id — and expects the 65-byte signature
 * as `r || s || recovery`. The result is the submission envelope
 * `{ raw_data, raw_data_hex, signature: [hex] }` that the node's submit
 * endpoint accepts, and `txHash` is the txID P4 already reported.
 *
 * The key buffer is zeroed in `finally`, so it is wiped whether signing
 * succeeds or throws.
 */
export async function signTronTx(input: SignInput): Promise<SignedTx> {
  const key = input.privateKey;
  try {
    const family = requireUnsignedTx(input.unsignedTx);
    if (family !== 'tron') {
      throw new SignerError(
        'UNSUPPORTED_FAMILY',
        `TRON signer cannot sign a "${family}" transaction`,
      );
    }
    requirePrivateKey(key, [32], 'tron');

    const payload = parsePayload(toBytesPayload(input.unsignedTx.serialized));
    const rawDataHex = readRawDataHex(payload, input.unsignedTx.meta);

    // The digest doubles as the transaction id on TRON.
    const digest = createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest();

    // `format: 'recovered'` yields [recovery, r, s]; TRON wants r || s || v.
    const recovered = secp256k1.sign(digest, key, { format: 'recovered' });
    const signature = new Uint8Array(65);
    signature.set(recovered.subarray(1), 0);
    signature[64] = recovered[0] ?? 0;
    const signatureHex = Buffer.from(signature).toString('hex');

    const publicKey = secp256k1.getPublicKey(key, false);
    if (!secp256k1.verify(recovered, digest, publicKey, { format: 'recovered' })) {
      throw new SignerError('SIGN_FAILED', 'the produced signature does not verify');
    }

    const signed = {
      raw_data: payload.raw_data,
      raw_data_hex: rawDataHex,
      signature: [signatureHex],
    };

    const digestHex = digest.toString('hex');
    const txID = metaString(input.unsignedTx.meta, 'txID') ?? digestHex;
    const warnings: string[] = [];
    if (txID !== digestHex) {
      warnings.push(
        `unsignedTx.meta.txID (${txID}) is not sha256(raw_data_hex) (${digestHex}); the node will recompute it`,
      );
    }

    const signerAddress = tronAddressFrom(publicKey);
    const expectedFrom = metaString(input.unsignedTx.meta, 'from');
    if (expectedFrom !== null && expectedFrom !== signerAddress) {
      warnings.push(
        `key signs as ${signerAddress} but the transaction was built for ${expectedFrom}`,
      );
    }

    return {
      family: 'tron',
      chainId: input.unsignedTx.chainId,
      network: input.unsignedTx.network,
      serialized: new TextEncoder().encode(JSON.stringify(signed)),
      txHash: txID,
      meta: {
        txID,
        rawDataHex,
        signature: [signatureHex],
        from: signerAddress,
        signatureLength: signatureHex.length,
        warnings,
      },
    };
  } catch (error) {
    throw asSignerError('tron', error);
  } finally {
    zeroIfBuffer(key);
  }
}

/** Parses the JSON payload P4 produced for this transaction. */
function parsePayload(bytes: Uint8Array): { raw_data?: unknown; raw_data_hex?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SignerError(
      'INVALID_INPUT',
      'unsignedTx.serialized must be the JSON transaction object produced by buildTx()',
      error,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SignerError('INVALID_INPUT', 'unsignedTx.serialized must decode to a JSON object');
  }
  return parsed as { raw_data?: unknown; raw_data_hex?: string };
}

/** Reads `raw_data_hex` from the payload, falling back to the builder meta. */
function readRawDataHex(
  payload: { raw_data_hex?: string },
  meta: Record<string, unknown> | undefined,
): string {
  const fromPayload = payload.raw_data_hex;
  if (
    typeof fromPayload === 'string' &&
    /^[0-9a-fA-F]+$/.test(fromPayload) &&
    fromPayload.length > 0
  ) {
    return fromPayload;
  }
  const fromMeta = metaString(meta, 'rawDataHex');
  if (fromMeta !== null && /^[0-9a-fA-F]+$/.test(fromMeta) && fromMeta.length > 0) {
    return fromMeta;
  }
  throw new SignerError(
    'INVALID_INPUT',
    'TRON signing requires raw_data_hex in the unsigned payload',
  );
}

/** Derives the base58 TRON address of an uncompressed secp256k1 public key. */
export function tronAddressFrom(publicKey: Uint8Array): string {
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new SignerError('SIGN_FAILED', 'expected an uncompressed secp256k1 public key');
  }
  const hash = keccak_256(publicKey.subarray(1));
  return tronFromHex(`0x41${Buffer.from(hash.subarray(12)).toString('hex')}`);
}
