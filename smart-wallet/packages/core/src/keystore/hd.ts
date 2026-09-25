import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  evmAddressFromPublicKey,
  solanaAddressFromPublicKey,
  tronAddressFromPublicKey,
} from './addresses';
import { toHex, type Hex } from './hex';
import { parseDerivationPath } from './paths';
import { ed25519DeriveChild, ed25519MasterFromSeed, ed25519PublicKey } from './slip10';
import { UnsupportedPathError } from './errors';

/** A derived keypair together with its chain-specific address. */
export interface DerivedKey {
  readonly privateKey: Hex;
  readonly publicKey: Hex;
  readonly address: string;
}

/**
 * Derives a keypair at `path` from a 64-byte BIP-39 seed.
 *
 * secp256k1 chains (EVM, TRON) use BIP-32; Solana uses SLIP-0010 ed25519.
 * The chain is inferred from the BIP-44 coin type.
 */
export function deriveFromSeed(seed: Uint8Array, path: string): DerivedKey {
  const parsed = parseDerivationPath(path);

  switch (parsed.chain) {
    case 'evm':
    case 'tron': {
      const node = HDKey.fromMasterSeed(seed).derive(path);
      const privateKey = node.privateKey;
      if (privateKey === null) {
        throw new UnsupportedPathError(path, 'no private key available for this node');
      }
      const publicKey = secp256k1.getPublicKey(privateKey, false);
      const address =
        parsed.chain === 'evm'
          ? evmAddressFromPublicKey(publicKey)
          : tronAddressFromPublicKey(publicKey);
      return { privateKey: toHex(privateKey), publicKey: toHex(publicKey), address };
    }
    case 'solana': {
      if (parsed.hardened.some((isHardened) => !isHardened)) {
        throw new UnsupportedPathError(
          path,
          'ed25519 (Solana) derivation requires every segment to be hardened',
        );
      }
      let node = ed25519MasterFromSeed(seed);
      for (const index of parsed.indices) {
        node = ed25519DeriveChild(node, index);
      }
      const publicKey = ed25519PublicKey(node);
      return {
        privateKey: toHex(node.privateKey),
        publicKey: toHex(publicKey),
        address: solanaAddressFromPublicKey(publicKey),
      };
    }
  }
}
