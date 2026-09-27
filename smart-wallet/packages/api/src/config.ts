/**
 * Runtime configuration, read from the process environment.
 *
 * Everything the API needs at runtime arrives here, so no value is hardcoded
 * and no secret lives in the repository: `JWT_SECRET` comes from the
 * environment, and when it is absent a random secret is generated for the life
 * of the process — right for development and tests, where every restart should
 * invalidate every token anyway.
 *
 * The rule `configFromEnv` → `applyConfig` keeps precedence explicit: a
 * dependency the caller passed in always wins, the environment only fills the
 * gaps. That is what lets tests inject their own stores without the ambient
 * environment changing their behaviour.
 */

import { randomJwtSecret } from './auth/jwt';
import { FileKeyStore, type KeyStore } from '@wallet/keys';
import type { AppDeps } from './app';

/** Deployment modes the configuration understands. */
export type NodeEnv = 'development' | 'test' | 'production';

/** Everything the API reads from the environment. */
export interface ApiConfig {
  /** Key the `/auth` tokens are signed with. Never logged. */
  readonly jwtSecret: Uint8Array;
  /** Directory a {@link FileKeyStore} is opened on, when mnemonics persist. */
  readonly keystoreDir: string | undefined;
  /** TCP port `startServer` binds. */
  readonly port: number;
  /** Deployment mode; affects defaults, never behaviour of a route. */
  readonly nodeEnv: NodeEnv;
}

/** Port used when `PORT` is absent. */
export const DEFAULT_PORT = 3000;

/** The environment variables this module reads. */
export const ENV_KEYS = {
  jwtSecret: 'JWT_SECRET',
  keystoreDir: 'KEYSTORE_DIR',
  port: 'PORT',
  nodeEnv: 'NODE_ENV',
} as const;

/** An invalid environment value, with the variable that caused it. */
export class ConfigError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`${key}: ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * Reads the configuration out of `env`.
 *
 * A missing value falls back to a safe default; a *malformed* value throws,
 * because silently ignoring `JWT_SECRET=short` is how a deployment ends up
 * signing tokens with a key nobody meant to use.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
  return {
    jwtSecret: readSecret(env[ENV_KEYS.jwtSecret]),
    keystoreDir: readDirectory(env[ENV_KEYS.keystoreDir]),
    port: readPort(env[ENV_KEYS.port]),
    nodeEnv: readNodeEnv(env[ENV_KEYS.nodeEnv]),
  };
}

/**
 * Fills the dependencies `config` provides that `deps` left unset.
 *
 * Explicit dependencies always win, so a test that passes its own
 * `jwtSecret` is never overridden by whatever the ambient environment holds.
 */
export function applyConfig(deps: AppDeps, config: ApiConfig): AppDeps {
  const keystore = deps.keystore ?? keystoreFrom(config.keystoreDir);
  return {
    ...deps,
    jwtSecret: deps.jwtSecret ?? config.jwtSecret,
    ...(keystore === undefined ? {} : { keystore }),
  };
}

/** Opens a {@link FileKeyStore} on `dir`, or nothing when no directory is set. */
export function keystoreFrom(dir: string | undefined): KeyStore | undefined {
  return dir === undefined ? undefined : new FileKeyStore(dir);
}

/**
 * Accepts a secret as 64 hex characters or as base64 of at least 32 bytes.
 *
 * Both forms are common in deployment tooling, and neither is stored: the value
 * is decoded straight into the key buffer.
 */
function readSecret(raw: string | undefined): Uint8Array {
  if (raw === undefined || raw.trim() === '') {
    return randomJwtSecret();
  }
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Uint8Array.from(Buffer.from(value, 'hex'));
  }
  try {
    const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
    if (bytes.length >= 32) {
      return bytes;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new ConfigError(ENV_KEYS.jwtSecret, 'must be 64 hex characters or base64 of 32+ bytes');
}

/** Reads a directory, treating blank as "not configured". */
function readDirectory(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  return raw.trim();
}

/** Reads a TCP port. */
function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(ENV_KEYS.port, 'must be an integer between 1 and 65535');
  }
  return port;
}

/** Reads the deployment mode. */
function readNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === undefined || raw.trim() === '') {
    return 'development';
  }
  const value = raw.trim();
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }
  throw new ConfigError(ENV_KEYS.nodeEnv, 'must be development, test or production');
}
