import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigError,
  DEFAULT_PORT,
  ENV_KEYS,
  applyConfig,
  configFromEnv,
  keystoreFrom,
} from '../config';
import { FileKeyStore } from '@wallet/keys';

/** A 32-byte secret as 64 hex characters. */
const HEX_SECRET = 'a'.repeat(64);

/** The same secret in base64, for the other accepted form. */
const BASE64_SECRET = Buffer.from('a'.repeat(64), 'hex').toString('base64');

let dir = '';

async function tempDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'wallet-config-'));
  return dir;
}

describe('configFromEnv defaults', () => {
  it('generates a secret when none is configured', () => {
    const config = configFromEnv({});

    expect(config.jwtSecret).toHaveLength(32);
    expect(config.keystoreDir).toBeUndefined();
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.nodeEnv).toBe('development');
  });

  it('generates a different secret per call', () => {
    const one = configFromEnv({}).jwtSecret;
    const two = configFromEnv({}).jwtSecret;

    expect(Buffer.from(one).toString('hex')).not.toBe(Buffer.from(two).toString('hex'));
  });

  it('treats a blank value as unset', () => {
    const config = configFromEnv({
      [ENV_KEYS.jwtSecret]: '   ',
      [ENV_KEYS.keystoreDir]: '  ',
      [ENV_KEYS.port]: '',
      [ENV_KEYS.nodeEnv]: '',
    });

    expect(config.jwtSecret).toHaveLength(32);
    expect(config.keystoreDir).toBeUndefined();
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.nodeEnv).toBe('development');
  });
});

describe('configFromEnv values', () => {
  it('reads a hex secret', () => {
    const config = configFromEnv({ [ENV_KEYS.jwtSecret]: HEX_SECRET });

    expect(Buffer.from(config.jwtSecret).toString('hex')).toBe(HEX_SECRET);
  });

  it('reads a base64 secret', () => {
    const config = configFromEnv({ [ENV_KEYS.jwtSecret]: BASE64_SECRET });

    expect(Buffer.from(config.jwtSecret).toString('hex')).toBe('a'.repeat(64));
  });

  it('reads the keystore directory, port and mode', () => {
    const config = configFromEnv({
      [ENV_KEYS.keystoreDir]: '/var/lib/wallet',
      [ENV_KEYS.port]: '8080',
      [ENV_KEYS.nodeEnv]: 'production',
    });

    expect(config.keystoreDir).toBe('/var/lib/wallet');
    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('production');
  });

  it('accepts every documented mode', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      expect(configFromEnv({ [ENV_KEYS.nodeEnv]: nodeEnv }).nodeEnv).toBe(nodeEnv);
    }
  });
});

describe('configFromEnv failures', () => {
  it('rejects a secret that is too short', () => {
    expect(() => configFromEnv({ [ENV_KEYS.jwtSecret]: 'abcd' })).toThrow(ConfigError);
    expect(() => configFromEnv({ [ENV_KEYS.jwtSecret]: 'abcd' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a base64 secret under 32 bytes', () => {
    expect(() =>
      configFromEnv({ [ENV_KEYS.jwtSecret]: Buffer.from('short').toString('base64') }),
    ).toThrow(ConfigError);
  });

  it('rejects a port that is not a port', () => {
    for (const port of ['0', '70000', 'http', '30.5']) {
      expect(() => configFromEnv({ [ENV_KEYS.port]: port })).toThrow(ConfigError);
    }
  });

  it('rejects an unknown mode', () => {
    expect(() => configFromEnv({ [ENV_KEYS.nodeEnv]: 'staging' })).toThrow(ConfigError);
  });

  it('names the offending variable in the message', () => {
    try {
      configFromEnv({ [ENV_KEYS.port]: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('PORT: must be an integer between 1 and 65535');
      expect((error as ConfigError).key).toBe('PORT');
    }
  });
});

describe('keystoreFrom', () => {
  it('returns nothing without a directory', () => {
    expect(keystoreFrom(undefined)).toBeUndefined();
  });

  it('returns a FileKeyStore for a directory', async () => {
    const store = keystoreFrom(await tempDir());

    expect(store).toBeInstanceOf(FileKeyStore);
    await rm(dir, { recursive: true, force: true });
    dir = '';
  });
});

describe('applyConfig', () => {
  it('fills what the caller left unset', () => {
    const config = configFromEnv({
      [ENV_KEYS.jwtSecret]: HEX_SECRET,
      [ENV_KEYS.keystoreDir]: '/var/lib/wallet',
    });

    const deps = applyConfig({}, config);

    expect(Buffer.from(deps.jwtSecret ?? new Uint8Array()).toString('hex')).toBe(HEX_SECRET);
    expect(deps.keystore).toBeInstanceOf(FileKeyStore);
  });

  it('never overrides a dependency the caller passed', async () => {
    const config = configFromEnv({ [ENV_KEYS.jwtSecret]: HEX_SECRET });
    const mine = new Uint8Array(32).fill(7);
    const store = new FileKeyStore(await tempDir());

    const deps = applyConfig({ jwtSecret: mine, keystore: store }, config);

    expect(deps.jwtSecret).toBe(mine);
    expect(deps.keystore).toBe(store);
  });

  it('leaves the keystore absent when neither side has one', () => {
    expect(applyConfig({}, configFromEnv({})).keystore).toBeUndefined();
  });

  it('opens a FileKeyStore on the configured directory', async () => {
    const target = await tempDir();
    const deps = applyConfig({}, configFromEnv({ [ENV_KEYS.keystoreDir]: target }));

    expect(deps.keystore).toBeInstanceOf(FileKeyStore);
    await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('keeps the other dependencies untouched', () => {
    const limiter = { check: () => ({ allowed: true }) } as never;

    expect(applyConfig({ rateLimiter: limiter }, configFromEnv({})).rateLimiter).toBe(limiter);
  });
});
