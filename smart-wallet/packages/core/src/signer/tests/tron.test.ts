import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { buildTx } from '../../tx-builder';
import { sign, signTronTx, tronAddressFrom } from '../index';
import type { UnsignedTx } from '../../tx-builder';

const FROM = 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn';
const TO = 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RAW_DATA_HEX = '0a021f2d2208' + 'ab'.repeat(20) + '40c8a5a9a5a5';

/** txID is sha256(raw_data_hex) on TRON, so the mock answers with the real one. */
const TX_ID = createHash('sha256').update(Buffer.from(RAW_DATA_HEX, 'hex')).digest('hex');

const RETRY = { attempts: 1, delayMs: 0, timeoutMs: 5_000 };

/** Builds an unsigned TRON transaction through the P4 builder. */
async function unsignedNative(): Promise<UnsignedTx> {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            txID: TX_ID,
            raw_data: { contract: [{ type: 'TransferContract' }] },
            raw_data_hex: RAW_DATA_HEX,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ),
  );

  return buildTx(
    {
      family: 'tron',
      chainId: 'tron',
      network: 'testnet',
      from: FROM,
      to: TO,
      amount: 25_000_000n,
    },
    { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
  );
}

function randomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

describe('signTronTx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs a native transfer and keeps the P4 txID', async () => {
    const privateKey = randomKey();
    const signed = await signTronTx({ unsignedTx: await unsignedNative(), privateKey });

    expect(signed.family).toBe('tron');
    expect(signed.chainId).toBe('tron');
    expect(signed.network).toBe('testnet');
    expect(signed.serialized).toBeInstanceOf(Uint8Array);

    // txHash is the txID P4 reported, never recomputed.
    expect(signed.txHash).toBe(TX_ID);

    // meta.signature is a non-empty array.
    const signatures = signed.meta.signature;
    expect(Array.isArray(signatures)).toBe(true);
    expect(signatures).toHaveLength(1);
    const signature = (signatures as string[])[0] ?? '';
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
    expect(signature).toMatch(/^[0-9a-f]{130}$/);

    // The envelope is the submission payload the node expects.
    const envelope = JSON.parse(Buffer.from(signed.serialized as Uint8Array).toString('utf8')) as {
      raw_data: unknown;
      raw_data_hex: string;
      signature: string[];
    };
    expect(envelope.raw_data_hex).toBe(RAW_DATA_HEX);
    expect(envelope.signature).toEqual([signature]);
    expect(envelope.raw_data).toEqual({ contract: [{ type: 'TransferContract' }] });
  });

  it('produces a signature that verifies against the transaction digest', async () => {
    const privateKey = randomKey();
    // Derived before signing: the signer wipes the key buffer afterwards.
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    const signed = await signTronTx({ unsignedTx: await unsignedNative(), privateKey });

    const digest = createHash('sha256').update(Buffer.from(RAW_DATA_HEX, 'hex')).digest();

    // The stored signature is r || s || recovery, noble expects recovery first.
    const bytes = Buffer.from((signed.meta.signature as string[])[0] ?? '', 'hex');
    const recoveredFormat = new Uint8Array(65);
    recoveredFormat[0] = bytes[64] ?? 0;
    recoveredFormat.set(bytes.subarray(0, 64), 1);

    expect(secp256k1.verify(recoveredFormat, digest, publicKey, { format: 'recovered' })).toBe(
      true,
    );
    expect(signed.meta.from).toBe(tronAddressFrom(publicKey));
  });

  it('warns when the txID does not match the payload digest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ txID: 'ff'.repeat(32), raw_data: {}, raw_data_hex: RAW_DATA_HEX }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const signed = await signTronTx({
      unsignedTx: await buildTx(
        { family: 'tron', chainId: 'tron', from: FROM, to: TO, amount: 1n },
        { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
      ),
      privateKey: randomKey(),
    });

    expect(signed.txHash).toBe('ff'.repeat(32));
    expect(signed.meta.warnings).toContainEqual(
      expect.stringContaining('is not sha256(raw_data_hex)'),
    );
  });

  it('signs a TRC-20 transfer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: { result: true },
              transaction: { txID: TX_ID, raw_data: { contract: [] }, raw_data_hex: RAW_DATA_HEX },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const unsigned = await buildTx(
      {
        family: 'tron',
        chainId: 'tron',
        from: FROM,
        to: TO,
        amount: 1_000_000n,
        token: { address: USDT, decimals: 6 },
      },
      { rpcUrls: ['https://nile.trongrid.io'], retry: RETRY },
    );

    const signed = await signTronTx({ unsignedTx: unsigned, privateKey: randomKey() });

    expect(signed.txHash).toBe(TX_ID);
    expect(signed.meta.signature).toHaveLength(1);
  });

  it('rejects payloads without raw_data_hex', async () => {
    const unsigned = await unsignedNative();
    const broken: UnsignedTx = {
      ...unsigned,
      serialized: new TextEncoder().encode(JSON.stringify({ raw_data: { contract: [] } })),
      meta: { ...unsigned.meta, rawDataHex: null },
    };

    await expect(signTronTx({ unsignedTx: broken, privateKey: randomKey() })).rejects.toMatchObject(
      {
        code: 'INVALID_INPUT',
      },
    );
  });

  it('rejects other families and malformed keys', async () => {
    await expect(
      signTronTx({
        unsignedTx: { ...(await unsignedNative()), family: 'evm' },
        privateKey: randomKey(),
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });

    await expect(
      signTronTx({ unsignedTx: await unsignedNative(), privateKey: new Uint8Array(31) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('is reachable through sign()', async () => {
    const signed = await sign({ unsignedTx: await unsignedNative(), privateKey: randomKey() });

    expect(signed.family).toBe('tron');
    expect(signed.txHash).toBe(TX_ID);
  });

  it('zeroes the key copy before returning and when throwing', async () => {
    const key = randomKey();
    await signTronTx({ unsignedTx: await unsignedNative(), privateKey: key });
    expect(key.every((byte) => byte === 0)).toBe(true);

    const other = randomKey();
    await expect(
      signTronTx({
        unsignedTx: { ...(await unsignedNative()), family: 'solana' },
        privateKey: other,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FAMILY' });
    expect(other.every((byte) => byte === 0)).toBe(true);
  });
});
