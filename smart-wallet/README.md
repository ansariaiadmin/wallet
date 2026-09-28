# Smart Wallet

Monorepo for the Smart Wallet platform — a pnpm workspace with five packages:
`core` (domain), `router` (dispatch), `api` (application surface), `sdk` (the
`SmartWallet` class) and `keys` (the only key layer).

## Layout

```
smart-wallet/
├── packages/
│   ├── core/     # domain primitives: money, oracle, risk, signer, tx-builder, cache
│   ├── chains/   # multi-chain RPC layer: EVM (viem), Solana (web3.js), TRON (TronGrid)
│   ├── router/   # typed route → handler registry
│   ├── api/      # wallet application surface wired on top of core + router
│   ├── keys/     # the only key layer: BIP-39, BIP-32/SLIP-0010, AES-256-GCM, signers
│   └── sdk/      # `SmartWallet`: one wallet surface over core + chains + keys
├── eslint.config.mjs      # shared ESLint flat config
├── tsconfig.base.json     # shared strict TS config + path aliases
└── pnpm-workspace.yaml
```

## Requirements

- Node.js >= 20
- pnpm 9 (`corepack enable`)

## Commands

| Command          | What it does                        |
| ---------------- | ----------------------------------- |
| `pnpm install`   | install workspace dependencies      |
| `pnpm test`      | run Vitest in every package         |
| `pnpm lint`      | run ESLint over the whole workspace |
| `pnpm typecheck` | run `tsc --noEmit` in every package |
| `pnpm format`    | format everything with Prettier     |

## Path aliases

TypeScript and Vitest both resolve the workspace sources directly, so packages
import each other without a build step:

| Alias          | Resolves to             |
| -------------- | ----------------------- |
| `@core/*`      | `packages/core/src/*`   |
| `@router/*`    | `packages/router/src/*` |
| `@api/*`       | `packages/api/src/*`    |
| `@sdk/*`       | `packages/sdk/src/*`    |
| `@chains/*`    | `packages/chains/src/*` |
| `@keys/*`      | `packages/keys/src/*`   |
| `@wallet/keys` | `packages/keys/src`     |

## Transaction builder

`packages/core/src/tx-builder` turns plain transfer parameters into an
**unsigned** transaction, priced with the P3 connectors:

```ts
import { buildTx } from '@wallet/core';

const tx = await buildTx(
  {
    family: 'evm', // 'evm' | 'solana' | 'tron'
    chainId: 'ethereum',
    network: 'testnet',
    from: '0x…',
    to: '0x…',
    amount: 250_000_000_000_000_000n,
  },
  { connector, nonce: 12n }, // connector prices the tx, nonce comes from the node
);
// tx.serialized → Uint8Array (EVM, Solana) or JSON bytes (TRON)
// tx.fee        → P3 FeeEstimate (zeroed, with a warning, without a connector)
// tx.meta       → nonce, gas, blockhash, txID, derived ATAs, warnings, …
```

No private key, mnemonic or signature ever enters this package (a test scans
the sources for that).

## Transaction signer

`packages/core/src/signer` takes an unsigned transaction from the builder plus
the caller's raw key material and returns a signed, broadcast-ready
transaction. The caller owns the key lifecycle (P2 `unlockWallet`), so the
signer works on a copy of the buffer and **zeroes it in a `finally` block** on
every path — success, failure and invalid input alike:

```ts
import { sign } from '@wallet/core';

const key = derivedKey.privateKey; // caller-owned copy
try {
  const signed = await sign({ unsignedTx: tx, privateKey: key });
  // signed.serialized → Uint8Array (EVM, Solana) or JSON bytes (TRON)
  // signed.txHash     → keccak256(signed bytes) | base58(first signature) | txID
  // signed.meta       → from, signature, nonce, blockhash, derived ATAs, …
} finally {
  key.fill(0); // the signer already zeroed the buffer it was handed
}
```

| Family   | Signing path                                                                      |
| -------- | --------------------------------------------------------------------------------- |
| `evm`    | viem `privateKeyToAccount(...).signTransaction`, `txHash = keccak256(signed)`     |
| `solana` | `Keypair.fromSecretKey` + `Transaction.from(...).sign`, `txHash = base58(sig[0])` |
| `tron`   | SHA-256 of `raw_data_hex`, secp256k1 via `@noble/curves`, `txHash = txID`         |

`sign` throws `SignerError` with code `UNSUPPORTED_FAMILY`, `SIGN_FAILED` or
`INVALID_INPUT`. Secp256k1 comes from `@noble/curves`, which is already in the
dependency tree (viem and `@scure/bip32` depend on it), so no new dependency was
added. A test scans the signer sources to make sure no key literal is stored in
them, and the family suites generate their keys at runtime.

## Key management

`packages/keys` (`@wallet/keys`) is the standalone key-management package:
mnemonics, derivation, at-rest encryption, keystores (in memory and on disk) and
per-family signers. Everything runs offline — no HTTP, and no key ever leaves
the process:

```ts
import { MemoryKeyStore, deriveEvm, createEvmSigner, signPayload } from '@wallet/keys';

const store = new MemoryKeyStore();
await store.store('default', mnemonic, 'keystore password');

const key = deriveEvm(await store.load('default', 'keystore password'));
const signer = createEvmSigner(key.privateKey);
const signature = await signer.signMessage('hello wallet');
signer.destroy(); // wipes the key copy
```

| Module            | What it owns                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| `mnemonic`        | `generate`/`validate`/`toSeed` on the English BIP-39 wordlist             |
| `slip10`          | HMAC-SHA512 hardened derivation for ed25519 (Solana)                      |
| `derive`          | BIP-44 paths and addresses for `evm`, `solana`, `tron`                    |
| `encrypt`         | AES-256-GCM + PBKDF2 (250 000 iterations) at-rest blobs                   |
| `keystore`        | `MemoryKeyStore` (`store`/`load`/`has`/`remove`) over those blobs         |
| `keystores/file`  | `FileKeyStore` — one encrypted file per id, `0600`, sanitized ids         |
| `signers/*`       | EVM (viem), Solana (`@solana/web3.js`) and TRON (secp256k1 + base58check) |
| `signers/payload` | `signPayload` — signs a builder payload with the family's signer          |

Derivation paths are `m/44'/60'/{account}'/0/{index}` (EVM),
`m/44'/195'/{account}'/0/{index}` (TRON) and `m/44'/501'/{index}'/0'` (Solana,
hardened SLIP-0010 only), so the addresses match what `@wallet/core` reports.
Failures throw `KeyStoreError` with codes `INVALID_MNEMONIC`, `WRONG_PASSWORD`,
`LOCKED`, `NOT_FOUND`, `UNSUPPORTED_FAMILY`, `DERIVE_FAILED`, `SIGN_FAILED` or
`INVALID_INPUT`.

`FileKeyStore` is the persistent backend: it writes the same AES-256-GCM blob to
`<dir>/<id>.enc` with owner-only permissions, and only accepts ids that are
letters, digits, `_` or `-` (1–64 of them), so an id can never walk out of the
directory:

```ts
import { FileKeyStore } from '@wallet/keys';

const store = new FileKeyStore('./data/keystore');
await store.store('wallet-main', mnemonic, 'keystore password');
await store.load('wallet-main', 'keystore password'); // the phrase, decrypted
await store.remove('wallet-main'); // NOT_FOUND when it was never there
```

The SDK takes the store through `WalletConfig.keystore`: when it is set,
`buildAndSign` loads the phrase from it and signs with these signers; without
it, the SDK keeps using the core keystore path. The two produce byte-identical
payloads for the same phrase and path (a test asserts exactly that).

## Auth

`packages/api/src/auth` adds JWT authentication and the wallet endpoints that go
with it, on `jose` (HS256, the only new dependency in the tree):

| Method   | Path             | Auth | What it does                                           |
| -------- | ---------------- | ---- | ------------------------------------------------------ |
| `POST`   | `/auth/register` | –    | username + password → user + wallet → token (201)      |
| `POST`   | `/auth/login`    | –    | username + password → token (200, 401 when wrong)      |
| `GET`    | `/auth/me`       | ✓    | the caller's user and wallet id (200, 401 without one) |
| `DELETE` | `/auth/logout`   | ✓    | revokes the token (204); it is refused afterwards      |

Passwords are stored as `scrypt` hashes (`N=16384, r=8, p=1`, per-user salt,
parameters carried in the hash) — never as plaintext, and never answered with.
Login runs scrypt even for an unknown username so the answer time does not
reveal whether a name exists. Logout is a token-id blacklist that remembers an
entry only until the token would have expired anyway.

`createApp` takes the seam through `AppDeps`:

```ts
const app = createApp({
  userStore: new MemoryUserStore(), // or a store of your own
  keystore: new FileKeyStore('./data/keystore'), // optional: mint a wallet on register
  jwtSecret: process.env.JWT_SECRET, // random per process when omitted
});
```

Without `jwtSecret` a random secret is generated for the life of the process —
right for dev and tests, since every restart then invalidates every token and
nothing secret has to be configured. The wallet endpoints (`/quote`, `/build`,
`broadcast`) stay public in this phase; `requireAuth` is exported for the phase
that locks them down.

## Configuration

Everything the API reads at runtime comes from the environment; copy
`.env.example` to `.env` (git-ignored) and fill in what you need. No value is
hardcoded and no secret belongs in the repository.

| Variable       | Required | Default            | What it does                                              |
| -------------- | -------- | ------------------ | --------------------------------------------------------- |
| `JWT_SECRET`   | prod     | random per process | Signs `/auth` tokens; 64 hex chars or base64 of 32+ bytes |
| `KEYSTORE_DIR` | no       | none               | Directory `FileKeyStore` keeps encrypted mnemonics in     |
| `PORT`         | no       | `3000`             | TCP port the server binds                                 |
| `NODE_ENV`     | no       | `development`      | Deployment mode                                           |
| `*_RPC_URL`    | no       | public endpoints   | Override the chain registry's endpoint list               |
| `RUN_E2E`      | no       | `0`                | Opt-in end-to-end tests against live testnets             |

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" # → JWT_SECRET
pnpm --filter @wallet/api start                                        # serves /api/v1
```

Without `JWT_SECRET` a random secret is generated for the life of the process,
so every restart invalidates every token — right for development, wrong for
production. A _malformed_ value throws at startup rather than being ignored:
`JWT_SECRET=short` failing loudly is what stops a deployment signing tokens
with a key nobody chose.

## One engine

`POST /api/v1/tx/build` runs through `SmartWallet.buildUnsigned()` from
`@wallet/sdk`, not the core builder directly. The method exists because the api
must never hold key material — it returns an unsigned transaction and lets the
caller sign it elsewhere — so the sdk gained a build-only entry point instead of
forcing the api to reach past it into `@wallet/core`.

```ts
import { SmartWallet } from '@wallet/sdk';

const unsigned = await new SmartWallet().buildUnsigned({
  network: 'ethereum',
  type: 'token',
  from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  amount: '1000000',
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
});
// unsigned.serialized is raw bytes; toHexPayload turns it into 0x02…
```

## API reference

`docs/openapi.yaml` is an OpenAPI 3.1 document covering every route, its
parameters, its responses and its error codes.

The document is **verified, not asserted**: `packages/api/src/tests/openapi.test.ts`
serves every route, checks that each one appears in the document, and checks
that the document names nothing the app does not serve. A route added without a
doc — or a doc left behind by a deleted route — fails the suite, so the
reference cannot drift from the implementation.

```
curl -s http://localhost:3000/api/v1/openapi.json   # if you serve it
# or read the source of truth directly:
cat docs/openapi.yaml
```

## Many wallets per user

A user owns any number of wallets, and each one gets its own keystore slot:
`walletId` is both the id the API reports and the key the encrypted mnemonic is
stored under, so two wallets never share an entry and never share a phrase.

```bash
# registering mints the first wallet and returns the phrase once
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"a good password"}'
# → { "token": "…", "user": { "walletIds": ["wallet_…"] }, "mnemonic": "…" }

# minting another: the token authorises it, the password re-encrypts the phrase
curl -s -X POST http://localhost:3000/api/v1/auth/wallets \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"label":"savings","password":"a good password"}'
# → { "walletId": "wallet_…", "label": "savings", "mnemonic": "…" }

curl -s http://localhost:3000/api/v1/auth/wallets \
  -H "Authorization: Bearer $TOKEN"
# → { "wallets": [{ "walletId": "wallet_…", "label": "", "createdAt": "…" }, …] }
```

The password is asked for again because encrypting a phrase needs the secret and
a bearer token deliberately does not carry one — caching it would turn a
short-lived token into a permanent one.

## Testing

```
pnpm -r test                       # 743 tests: 734 passed, 9 skipped (5 live-RPC + 4 recorded e2e)
RUN_E2E=1 pnpm --filter @wallet/api test    # + 4 recorded-fixture e2e tests
```

Two suites are env-gated and skipped by default, and the reason is the same for
both: they need a network this sandbox does not have.

- `RUN_INTEGRATION=1` in `@wallet/chains` talks to real testnets.
- `RUN_E2E=1` in `@wallet/api` replays **recorded** JSON-RPC fixtures — no
  network, no key, no faucet. It exercises the whole path from request to JSON
  body, and it proves nothing about whether a node is up. A green `RUN_E2E` is
  not a green mainnet, and `src/tests/e2e/recorded.test.ts` says so in its own
  header.

Every fixture must answer a `result`, never an `error`: a fixture that answers an
error is a fixture nobody really recorded.

## Observability

Every `/api/v1` request is timed, counted and labelled by route pattern, and
`/health` reports what the app has served. Nothing is logged that could be a
secret: `redacted()` turns a password into `{ present: true }`.

```bash
curl localhost:3000/api/v1/metrics                  # Prometheus text
curl -H 'accept: application/json' localhost:3000/api/v1/metrics
curl localhost:3000/api/v1/health
```

```
wallet_http_requests_total{route="/api/v1/price/:symbol"} 2
wallet_http_errors_total{route="/api/v1/price/:symbol"} 0
wallet_http_duration_ms_bucket{route="/api/v1/price/:symbol",le="5"} 1
wallet_uptime_seconds 42.118
```

The registry is a value, not a module: two apps in one process keep separate
counters, which is the same rule the tx store and the cache stores follow. Logs
are one JSON object per line, with `ts`, `level`, `msg` first so two lines for
the same event diff cleanly. `createApp({ logger: nullLogger })` silences a test.

## CI

`.github/workflows/ci.yml` runs lint + test on every push and pull request to
`main`.
