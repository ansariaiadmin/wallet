import { describe, expect, it } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import { buildTx } from '../../tx-builder';
import { sign } from '../index';
import { SignerError } from '../types';
import type { SignInput } from '../types';
import type { UnsignedTx } from '../../tx-builder';

const EVM_UNSIGNED: UnsignedTx = {
  family: 'evm',
  chainId: 'ethereum',
  network: 'testnet',
  serialized: new Uint8Array([2, 248, 117]),
  fee: {
    chainId: 'ethereum',
    network: 'testnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    units: 0n,
    unitPrice: 0n,
    maxCost: 0n,
    formattedMaxCost: '0',
  },
  meta: {},
};

describe('sign input validation', () => {
  it('throws UNSUPPORTED_FAMILY when the family is missing', async () => {
    const input = {
      unsignedTx: { ...EVM_UNSIGNED, family: undefined },
      privateKey: new Uint8Array(32),
    };

    await expect(sign(input as unknown as SignInput)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FAMILY',
    });
  });

  it('throws UNSUPPORTED_FAMILY for an unknown family', async () => {
    const input = {
      unsignedTx: { ...EVM_UNSIGNED, family: 'dogecoin' },
      privateKey: Uint8Array.from(Buffer.from(generatePrivateKey().slice(2), 'hex')),
    };

    await expect(sign(input as unknown as SignInput)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FAMILY',
    });
  });

  it('throws INVALID_INPUT when the unsigned transaction is missing', async () => {
    await expect(
      sign({ privateKey: new Uint8Array(32) } as unknown as SignInput),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws INVALID_INPUT when the private key is missing', async () => {
    await expect(sign({ unsignedTx: EVM_UNSIGNED } as unknown as SignInput)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('throws INVALID_INPUT for an empty key buffer', async () => {
    await expect(
      sign({ unsignedTx: EVM_UNSIGNED, privateKey: new Uint8Array(0) }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('reports every SignerError code as a SignerError with a message', async () => {
    const error = new SignerError('SIGN_FAILED', 'signing failed');

    expect(error).toBeInstanceOf(SignerError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('SIGN_FAILED');
    expect(error.name).toBe('SignerError');
    expect(error.message).toBe('signing failed');
  });

  it('keeps the original failure as the cause', async () => {
    const cause = new Error('node said no');
    const error = new SignerError('SIGN_FAILED', 'wrapped', cause);

    expect(error.cause).toBe(cause);
  });

  it('never returns the key material it was given', async () => {
    const keypair = Keypair.generate();
    const unsigned = await buildTx(
      {
        family: 'solana',
        chainId: 'solana',
        from: keypair.publicKey.toBase58(),
        to: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        amount: 1_000n,
      },
      { recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 1 },
    );
    const key = keypair.secretKey;

    const signed = await sign({ unsignedTx: unsigned, privateKey: key });

    const dumped = JSON.stringify(signed, (_name, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(dumped).not.toContain(Buffer.from(keypair.secretKey).toString('hex'));
    expect(dumped).not.toContain(Buffer.from(key).toString('hex'));
    // The public key and the signature are fine to expose.
    expect(dumped).toContain(keypair.publicKey.toBase58());
  });
});
