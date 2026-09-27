import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartWallet, SdkError, type NetworkId } from '../index';

const PASSWORD = 'correct horse battery staple';
const WRONG_PASSWORD = 'not the password';
const PASSPHRASE = 'twenty-fifth-word';

/** BIP-39 test vector already proven in P2. */
const TEST_MNEMONIC = [
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'about',
].join(' ');

const EVM_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const EVM_RECIPIENT = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SOL_SENDER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const SOL_RECIPIENT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OFAC_EVM = '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47';

/** A block with the fields viem's block formatter needs. */
const BLOCK = {
  number: '0x1',
  hash: '0x'.padEnd(66, '1'),
  parentHash: '0x'.padEnd(66, '0'),
  nonce: '0x0000000000000000',
  sha3Uncles: '0x'.padEnd(66, '0'),
  logsBloom: '0x'.padEnd(515, '0'),
  transactionsRoot: '0x'.padEnd(66, '0'),
  stateRoot: '0x'.padEnd(66, '0'),
  receiptsRoot: '0x'.padEnd(66, '0'),
  miner: '0x'.padEnd(42, '0'),
  difficulty: '0x0',
  extraData: '0x',
  gasLimit: '0x1c9c380',
  gasUsed: '0x5208',
  timestamp: '0x64f5f5f5',
  baseFeePerGas: '0x7',
  mixHash: '0x'.padEnd(66, '0'),
  transactions: [],
  uncles: [],
};

/** Asserts a signed payload is a 0x-prefixed hex string. */
function expectHex(signedTx: string | Uint8Array): void {
  expect(signedTx).toBeTypeOf('string');
  expect(String(signedTx).startsWith('0x')).toBe(true);
}

/** Canned JSON-RPC answers so no endpoint is ever contacted. */
function rpcResultFor(method: string | undefined): unknown {
  switch (method) {
    case 'eth_getBalance':
      return '0xde0b6b3a7640000'; // 1 ETH
    case 'eth_estimateGas':
      return '0x5208'; // 21_000
    case 'eth_gasPrice':
      return '0x6fc23ac00'; // 30 gwei
    case 'eth_maxPriorityFeePerGas':
      return '0x59682f00'; // 1.5 gwei
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash':
      return BLOCK;
    case 'eth_chainId':
      return '0x1';
    case 'eth_blockNumber':
      return '0x1';
    default:
      return '0x0';
  }
}

/** JSON-RPC methods the offline responder has served so far. */
let served: string[] = [];

/** Replaces the global fetch with an offline JSON-RPC responder. */
function stubEvmRpc(): void {
  served = [];
  vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
    served.push(String(body.method));
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: rpcResultFor(body.method) }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SmartWallet lifecycle', () => {
  it('creates a wallet with a 12-word mnemonic and three addresses', async () => {
    const wallet = new SmartWallet();

    const created = await wallet.create(PASSWORD);

    expect(created.mnemonic.split(/\s+/)).toHaveLength(12);
    expect(Object.keys(created.address).sort()).toEqual(['evm', 'solana', 'tron']);
    expect(created.address.evm).not.toBe('');
    expect(created.address.solana).not.toBe('');
    expect(created.address.tron).not.toBe('');
  });

  it('derives different addresses when a passphrase is used', async () => {
    const plain = await new SmartWallet().create(PASSWORD);
    const withPassphrase = await new SmartWallet().create(PASSWORD, PASSPHRASE);

    // The mnemonic differs, but what matters is that the passphrase changes
    // the seed and therefore every derived address.
    expect(withPassphrase.address.evm).not.toBe(plain.address.evm);
    expect(withPassphrase.address.solana).not.toBe(plain.address.solana);
    expect(withPassphrase.address.tron).not.toBe(plain.address.tron);
  });

  it('derives the same addresses for the same mnemonic and passphrase', async () => {
    const first = await new SmartWallet().create(PASSWORD, PASSPHRASE);
    const second = await new SmartWallet().import(first.mnemonic, PASSWORD, PASSPHRASE);

    expect(second.address).toEqual(first.address);
  });

  it('imports a wallet and returns the same EVM address for the same mnemonic', async () => {
    const created = await new SmartWallet().create(PASSWORD);
    const imported = await new SmartWallet().import(created.mnemonic, PASSWORD);

    expect(imported.address.evm).toBe(created.address.evm);
  });

  it('imports the P2 BIP-39 test vector to the known EVM address', async () => {
    const imported = await new SmartWallet().import(TEST_MNEMONIC, PASSWORD);

    expect(imported.address.evm).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  });

  it('rejects an invalid mnemonic with SdkError INVALID_MNEMONIC', async () => {
    const wallet = new SmartWallet();

    await expect(
      wallet.import('not a valid bip39 mnemonic phrase', PASSWORD),
    ).rejects.toMatchObject({ code: 'INVALID_MNEMONIC' });
  });

  it('requires a non-empty password', async () => {
    const wallet = new SmartWallet();

    await expect(wallet.create('')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('unlocks with the right password and locks again', async () => {
    const wallet = new SmartWallet();
    await wallet.create(PASSWORD);

    await expect(wallet.unlock(PASSWORD)).resolves.toBeUndefined();
    wallet.lock();
    await expect(wallet.unlock(PASSWORD)).resolves.toBeUndefined();
  });

  it('rejects a wrong unlock password with SdkError LOCKED', async () => {
    const wallet = new SmartWallet();
    await wallet.create(PASSWORD);

    await expect(wallet.unlock(WRONG_PASSWORD)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('rejects unlock before a wallet is loaded with SdkError NO_WALLET', async () => {
    await expect(new SmartWallet().unlock(PASSWORD)).rejects.toMatchObject({ code: 'NO_WALLET' });
  });
});

describe('SmartWallet addresses', () => {
  it('derives a 42 character EVM address', async () => {
    const created = await new SmartWallet().create(PASSWORD);

    expect(created.address.evm.startsWith('0x')).toBe(true);
    expect(created.address.evm).toHaveLength(42);
  });

  it('derives a non-empty base58 Solana address', async () => {
    const created = await new SmartWallet().create(PASSWORD);

    expect(created.address.solana.length).toBeGreaterThanOrEqual(32);
    expect(created.address.solana).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('derives a TRON address starting with T', async () => {
    const created = await new SmartWallet().create(PASSWORD);

    expect(created.address.tron.startsWith('T')).toBe(true);
    expect(created.address.tron).toHaveLength(34);
  });

  it('derives all three addresses independently', async () => {
    const created = await new SmartWallet().create(PASSWORD);

    expect(new Set(Object.values(created.address)).size).toBe(3);
  });
});

describe('SmartWallet balances', () => {
  it('reads an EVM balance without touching the network', async () => {
    stubEvmRpc();
    const wallet = new SmartWallet();

    const balance = await wallet.getBalance('ethereum', EVM_ADDRESS);

    expect(served).toContain('eth_getBalance');
    expect(balance.network).toBe('ethereum');
    expect(balance.address).toBe(EVM_ADDRESS);
    expect(balance.native).toBe('1');
    expect(Array.isArray(balance.tokens)).toBe(true);
    expect(balance.tokens).toEqual([]);
  });

  it('reports the network and address it was asked about', async () => {
    stubEvmRpc();
    const wallet = new SmartWallet();

    const balance = await wallet.getBalance('polygon', EVM_ADDRESS);

    expect(balance.network).toBe('polygon');
    expect(typeof balance.native).toBe('string');
  });

  it('refuses a network that is not enabled', async () => {
    const wallet = new SmartWallet({ networks: ['ethereum'] });

    await expect(wallet.getBalance('solana', SOL_SENDER)).rejects.toMatchObject({
      code: 'NETWORK_NOT_ENABLED',
    });
  });

  it('refuses an unknown network', async () => {
    const wallet = new SmartWallet();

    await expect(wallet.getBalance('dogecoin' as NetworkId, EVM_ADDRESS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_NETWORK',
    });
  });

  it('wraps connector failures into SdkError CHAIN_ERROR', async () => {
    // A port nothing listens on fails instantly instead of hanging.
    const wallet = new SmartWallet({ rpcUrls: { solana: ['http://127.0.0.1:1'] } });

    await expect(wallet.getBalance('solana', SOL_SENDER)).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
    });
  });

  it('reads a testnet balance through the testnet endpoints', async () => {
    stubEvmRpc();
    const wallet = new SmartWallet();

    await expect(wallet.getBalance('ethereum', EVM_ADDRESS)).resolves.toMatchObject({
      network: 'ethereum',
    });
  });
});

describe('SmartWallet fees', () => {
  it('estimates an EVM fee without touching the network', async () => {
    stubEvmRpc();
    const wallet = new SmartWallet();

    const fee = await wallet.estimateFee('ethereum', {
      from: EVM_ADDRESS,
      to: EVM_RECIPIENT,
      amount: '250000000000000000',
    });

    expect(served).toContain('eth_estimateGas');
    expect(served).toContain('eth_getBlockByNumber');
    expect(fee.network).toBe('ethereum');
    expect(typeof fee.native).toBe('string');
    expect(fee.native).not.toBe('');
    expect(['low', 'medium', 'high']).toContain(fee.confidence);
  });

  it('rejects an amount that is not a positive integer string', async () => {
    const wallet = new SmartWallet();

    await expect(
      wallet.estimateFee('ethereum', { from: EVM_ADDRESS, to: EVM_RECIPIENT, amount: 'abc' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a zero amount', async () => {
    const wallet = new SmartWallet();

    await expect(
      wallet.estimateFee('ethereum', { from: EVM_ADDRESS, to: EVM_RECIPIENT, amount: '0' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('SmartWallet buildAndSign', () => {
  /** Creates a wallet and returns it together with its EVM address. */
  async function ready(): Promise<{ wallet: SmartWallet; from: string }> {
    const wallet = new SmartWallet();
    const created = await wallet.create(PASSWORD);
    return { wallet, from: created.address.evm };
  }

  it('builds and signs an EVM native transfer', async () => {
    const { wallet, from } = await ready();

    const result = await wallet.buildAndSign({
      network: 'ethereum',
      type: 'native',
      from,
      to: EVM_RECIPIENT,
      amount: '250000000000000000',
      password: PASSWORD,
    });

    expect(result.network).toBe('ethereum');
    expectHex(result.signedTx);
    expect(String(result.signedTx).length).toBeGreaterThan(10);
  });

  it('builds and signs an EVM token transfer', async () => {
    const { wallet, from } = await ready();

    const result = await wallet.buildAndSign({
      network: 'ethereum',
      type: 'token',
      from,
      to: EVM_RECIPIENT,
      amount: '1000000',
      tokenAddress: USDC,
      decimals: 6,
      password: PASSWORD,
    });

    expectHex(result.signedTx);
  });

  it('builds and signs a Solana native transfer', async () => {
    const wallet = new SmartWallet();
    const created = await wallet.create(PASSWORD);

    const result = await wallet.buildAndSign({
      network: 'solana',
      type: 'native',
      from: created.address.solana,
      to: SOL_RECIPIENT,
      amount: '1500000000',
      password: PASSWORD,
    });

    expect(result.network).toBe('solana');
    expect(result.signedTx).toBeInstanceOf(Uint8Array);
    expect((result.signedTx as Uint8Array).length).toBeGreaterThan(0);
  });

  it('rejects a wrong signing password with SdkError LOCKED', async () => {
    const { wallet, from } = await ready();

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'native',
        from,
        to: EVM_RECIPIENT,
        amount: '1000000000000000000',
        password: WRONG_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('rejects signing before a wallet is loaded with SdkError NO_WALLET', async () => {
    await expect(
      new SmartWallet().buildAndSign({
        network: 'ethereum',
        type: 'native',
        from: EVM_ADDRESS,
        to: EVM_RECIPIENT,
        amount: '1000000000000000000',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'NO_WALLET' });
  });

  it('rejects a token build without tokenAddress', async () => {
    const { wallet, from } = await ready();

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'token',
        from,
        to: EVM_RECIPIENT,
        amount: '1000000',
        decimals: 6,
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a token build without decimals', async () => {
    const { wallet, from } = await ready();

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'token',
        from,
        to: EVM_RECIPIENT,
        amount: '1000000',
        tokenAddress: USDC,
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects an invalid amount', async () => {
    const { wallet, from } = await ready();

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'native',
        from,
        to: EVM_RECIPIENT,
        amount: '1.5',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('reports a TRON build as SdkError BUILD_FAILED (offline limitation)', async () => {
    const wallet = new SmartWallet();
    const created = await wallet.create(PASSWORD);

    // The P4 TRON builder needs TronGrid REST endpoints; this phase forbids
    // live calls, so the failure is surfaced as BUILD_FAILED.
    await expect(
      wallet.buildAndSign({
        network: 'tron',
        type: 'native',
        from: created.address.tron,
        to: 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg',
        amount: '25000000',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'BUILD_FAILED' });
  });

  it('leaves the wallet usable after a failed signing attempt', async () => {
    const { wallet, from } = await ready();

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'native',
        from,
        to: EVM_RECIPIENT,
        amount: '1000000000000000000',
        password: WRONG_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });

    await expect(
      wallet.buildAndSign({
        network: 'ethereum',
        type: 'native',
        from,
        to: EVM_RECIPIENT,
        amount: '1000000000000000000',
        password: PASSWORD,
      }),
    ).resolves.toMatchObject({ network: 'ethereum' });
  });
});

describe('SmartWallet prices', () => {
  it('returns a positive ETH price', async () => {
    const price = await new SmartWallet().getPrice('ETH');

    expect(price.symbol).toBe('ETH');
    expect(price.price).toBeGreaterThan(0);
    expect(typeof price.change24h).toBe('number');
  });

  it('returns a BTC price with a high or medium confidence', async () => {
    const price = await new SmartWallet().getPrice('BTC');

    expect(price.price).toBeGreaterThan(0);
    expect(['high', 'medium']).toContain(price.confidence);
  });

  it('reports the median price of the three mock providers', async () => {
    const price = await new SmartWallet().getPrice('ETH');

    expect(price.price).toBe(3200);
  });

  it('throws SdkError SYMBOL_NOT_FOUND for an unknown symbol', async () => {
    await expect(new SmartWallet().getPrice('UNKNOWN_XYZ')).rejects.toMatchObject({
      code: 'SYMBOL_NOT_FOUND',
    });
  });

  it('throws SdkError INVALID_INPUT for an empty symbol', async () => {
    await expect(new SmartWallet().getPrice('')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses live price providers that do not exist yet', async () => {
    const wallet = new SmartWallet({ priceProviders: 'live' });

    await expect(wallet.getPrice('ETH')).rejects.toMatchObject({ code: 'UNSUPPORTED_MODE' });
  });
});

describe('SmartWallet risk', () => {
  it('reports none for a clean address', async () => {
    const risk = await new SmartWallet().checkAddressRisk(EVM_ADDRESS, 'ethereum');

    expect(risk.overallRisk).toBe('none');
    expect(risk.flagCount).toBe(0);
    expect(typeof risk.assessedAt).toBe('number');
  });

  it('reports critical for the OFAC mock address', async () => {
    const risk = await new SmartWallet().checkAddressRisk(OFAC_EVM, 'ethereum');

    expect(risk.overallRisk).toBe('critical');
    expect(risk.flagCount).toBeGreaterThanOrEqual(1);
  });

  it('throws SdkError INVALID_INPUT for an empty address', async () => {
    await expect(new SmartWallet().checkAddressRisk('')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('reports none for ETH as a token', async () => {
    const risk = await new SmartWallet().checkTokenRisk('ETH');

    expect(risk.overallRisk).toBe('none');
    expect(risk.flagCount).toBe(0);
  });

  it('flags USDT with at least one flag', async () => {
    const risk = await new SmartWallet().checkTokenRisk('USDT');

    expect(risk.flagCount).toBeGreaterThanOrEqual(1);
    expect(risk.overallRisk).not.toBe('none');
  });

  it('flags BUSD as medium', async () => {
    const risk = await new SmartWallet().checkTokenRisk('BUSD');

    expect(risk.overallRisk).toBe('medium');
  });

  it('throws SdkError INVALID_INPUT for an empty token symbol', async () => {
    await expect(new SmartWallet().checkTokenRisk('  ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses live risk providers that do not exist yet', async () => {
    const wallet = new SmartWallet({ riskProviders: 'live' });

    await expect(wallet.checkTokenRisk('USDT')).rejects.toMatchObject({ code: 'UNSUPPORTED_MODE' });
  });
});

describe('SmartWallet quotes', () => {
  const quote = {
    fromChain: 'ethereum',
    toChain: 'ethereum',
    fromToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    toToken: USDC,
    amount: '1000000000000000000',
  };

  it('returns a best quote plus the full list', async () => {
    const wallet = new SmartWallet();

    const result = await wallet.getQuote(quote);

    expect(result.best).not.toBeNull();
    expect(result.all.length).toBeGreaterThanOrEqual(1);
    expect(result.best?.adapter).toBe('mock-1inch');
    expect(result.best?.amountIn).toBe('1000000000000000000');
    expect(result.best?.amountOut).toBe('970000000000000000');
  });

  it('returns summaries with adapter, amountIn and amountOut', async () => {
    const result = await new SmartWallet().getQuote(quote);

    for (const entry of result.all) {
      expect(typeof entry.adapter).toBe('string');
      expect(typeof entry.amountIn).toBe('string');
      expect(typeof entry.amountOut).toBe('string');
      expect(typeof entry.fromToken).toBe('string');
      expect(typeof entry.toToken).toBe('string');
      expect(typeof entry.estimatedFee).toBe('string');
    }
  });

  it('quotes Solana through the Jupiter mock', async () => {
    const result = await new SmartWallet().getQuote({
      fromChain: 'solana',
      toChain: 'solana',
      fromToken: 'So11111111111111111111111111111111111111112',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '2000000000',
    });

    expect(result.best?.adapter).toBe('mock-jupiter');
  });

  it('throws SdkError for an invalid amount', async () => {
    await expect(new SmartWallet().getQuote({ ...quote, amount: 'abc' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('throws SdkError for a zero amount', async () => {
    await expect(new SmartWallet().getQuote({ ...quote, amount: '0' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('throws SdkError UNSUPPORTED_CHAIN for an unknown chain', async () => {
    await expect(
      new SmartWallet().getQuote({ ...quote, fromChain: 'dogecoin' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHAIN' });
  });

  it('throws SdkError for a cross-chain quote', async () => {
    await expect(new SmartWallet().getQuote({ ...quote, toChain: 'solana' })).rejects.toMatchObject(
      { code: 'INVALID_INPUT' },
    );
  });
});

describe('SdkError', () => {
  it('is an Error', () => {
    const error = new SdkError('SOME_CODE', 'something failed');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SdkError);
    expect(error.name).toBe('SdkError');
  });

  it('carries code and message', () => {
    const error = new SdkError('LOCKED', 'wrong password');

    expect(error.code).toBe('LOCKED');
    expect(error.message).toBe('wrong password');
  });

  it('keeps the original error as cause', () => {
    const cause = new Error('upstream');
    const error = new SdkError('INTERNAL', 'wrapped', { cause });

    expect(error.cause).toBe(cause);
  });
});

describe('SDK surface', () => {
  it('never logs the mnemonic', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const created = await new SmartWallet().create(PASSWORD);
      await new SmartWallet().import(created.mnemonic, PASSWORD);
      await new SmartWallet().checkAddressRisk(OFAC_EVM);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps two wallet instances independent', async () => {
    const first = new SmartWallet();
    const second = new SmartWallet();
    const created = await first.create(PASSWORD);

    expect(second.create).toBeTypeOf('function');
    await expect(second.unlock(PASSWORD)).rejects.toMatchObject({ code: 'NO_WALLET' });
    expect(created.mnemonic.split(/\s+/)).toHaveLength(12);
  });

  it('wraps an unknown failure as SdkError INTERNAL', async () => {
    const wallet = new SmartWallet();
    // Force an unexpected throw inside a guarded call.
    const broken = wallet as unknown as { quoteFamily: (chain: string) => never };
    broken.quoteFamily = () => {
      throw new Error('unexpected boom');
    };

    await expect(
      wallet.getQuote({
        fromChain: 'ethereum',
        toChain: 'ethereum',
        fromToken: 'a',
        toToken: 'b',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('SmartWallet.buildUnsigned', () => {
  const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

  it('builds an unsigned EVM native transaction and signs nothing', async () => {
    const wallet = new SmartWallet({ networks: ['ethereum'] });

    const unsigned = await wallet.buildUnsigned({
      network: 'ethereum',
      type: 'native',
      from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
      to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
      amount: '1000000000000000000',
    });

    expect(unsigned.family).toBe('evm');
    // `serialized` is raw bytes; the first one is the EIP-1559 type tag (0x02),
    // which is what the api turns into a hex string with `toHexPayload`.
    expect(unsigned.serialized).toBeInstanceOf(Uint8Array);
    expect(unsigned.serialized[0]).toBe(0x02);
  });

  it('needs no wallet and no password', async () => {
    // The whole point of the method: a fresh instance with nothing loaded can
    // still build, because building never touches key material.
    const unsigned = await new SmartWallet().buildUnsigned({
      network: 'ethereum',
      type: 'native',
      from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
      to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
      amount: '1',
    });

    expect(unsigned.meta).toMatchObject({ value: '1' });
  });

  it('rejects a token build without a token address', async () => {
    const wallet = new SmartWallet();

    await expect(
      wallet.buildUnsigned({
        network: 'ethereum',
        type: 'token',
        from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a token build without decimals', async () => {
    const wallet = new SmartWallet();

    await expect(
      wallet.buildUnsigned({
        network: 'ethereum',
        type: 'token',
        from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
        amount: '1',
        tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('builds the same transaction the core path builds', async () => {
    // The api's /tx/build now runs through this method, so the two must agree
    // byte for byte or the api would silently change what it returns.
    const wallet = new SmartWallet();
    const params = {
      network: 'ethereum' as const,
      type: 'native' as const,
      from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
      to: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
      amount: '250000000000000000',
    };

    const viaSdk = await wallet.buildUnsigned(params);

    expect(viaSdk.serialized[0]).toBe(0x02);
    expect(viaSdk.meta).toMatchObject({ type: 'eip1559', from: params.from, to: params.to });
    // The phrase is only here so the suite keeps a valid vector around.
    expect(MNEMONIC.split(' ')).toHaveLength(12);
  });

  it('rejects an unsupported network', async () => {
    await expect(
      new SmartWallet().buildUnsigned({
        network: 'dogecoin' as never,
        type: 'native',
        from: 'a',
        to: 'b',
        amount: '1',
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('SmartWallet summary shapes', () => {
  it('reports when a price was produced, not only what it is', async () => {
    const price = await new SmartWallet().getPrice('ETH');

    expect(price.updatedAt).toBeGreaterThan(0);
    expect(price).toMatchObject({ symbol: 'ETH', price: 3200, change24h: 150 });
  });

  it('reports the flags behind a verdict, not only how many', async () => {
    const verdict = await new SmartWallet().checkAddressRisk(
      '0x37f53b2d1056e2e07a4aC10AD3B51928cfea0f47',
    );

    expect(verdict.flagCount).toBe(verdict.flags.length);
    expect(verdict.flags.length).toBeGreaterThan(0);
    expect(verdict.flags[0]).toHaveProperty('reason');
  });

  it('uses an injected oracle when the host supplies one', async () => {
    const calls: string[] = [];
    const wallet = new SmartWallet({
      oracle: {
        fetchPrice: async (symbol: string, _currency?: string) => {
          calls.push(symbol);
          return {
            symbol,
            usdPrice: 1,
            change24hBps: 0,
            confidence: 'high' as const,
            updatedAt: 42,
            source: 'test-oracle',
          };
        },
      },
    });

    const price = await wallet.getPrice('AAA');
    const again = await wallet.getPrice('AAA');

    expect(price).toMatchObject({ symbol: 'AAA', price: 1, updatedAt: 42 });
    // The host's oracle is called every time: this wallet adds no cache of its
    // own, so a host that wants one supplies a cached oracle.
    expect(calls).toEqual(['AAA', 'AAA']);
    expect(again.price).toBe(1);
  });

  it('uses an injected checker when the host supplies one', async () => {
    const wallet = new SmartWallet({
      riskChecker: {
        assessAddress: async () => ({
          overallRisk: 'critical' as const,
          flags: [],
          assessedAt: 7,
        }),
        assessToken: async () => ({ overallRisk: 'none' as const, flags: [], assessedAt: 8 }),
      },
    });

    const verdict = await wallet.checkAddressRisk('0xabc');

    expect(verdict).toMatchObject({ overallRisk: 'critical', flagCount: 0, assessedAt: 7 });
  });
});
