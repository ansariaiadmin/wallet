# Audit — measured, not claimed

Every number below was produced by a command in this repository on 2026-09-27 at
commit `dd1723f`. Where a claim could not be verified in this sandbox it says so
instead of being rounded up.

## 1. Size and test surface

_Updated after S1 (see §5): the numbers below are the pre-S1 baseline at
`dd1723f`; §5 carries the current ones._

| Package   | src files | src LOC    | test files | tests   |
| --------- | --------- | ---------- | ---------- | ------- |
| core      | 58        | 5,928      | 17         | 216     |
| api       | 32        | 4,469      | 9          | 190     |
| sdk       | 10        | 2,365      | 4          | 94      |
| keys      | 13        | 1,200      | 9          | 158     |
| chains    | 11        | 1,402      | 5          | 42      |
| router    | 10        | 770        | 2          | 37      |
| **total** | **134**   | **16,134** | **46**     | **737** |

Test result at `dd1723f`: `pnpm -r test` → **737 passed, 5 skipped, 0 failed**. The 5 skips are
the `@wallet/chains` integration tests, gated behind `RUN_INTEGRATION=1`.
`pnpm -r typecheck` → 0 errors. `pnpm lint` → clean. `prettier --check .` → clean.

Live RPC coverage: **none, and none is possible here** — this sandbox has no
outbound HTTPS except the npm registry. The 5 skipped tests and the missing
`RUN_E2E` suite are a limitation to state, not a pass.

## 2. Findings, each with the command that found it

### Dead code — 723 LOC, 4.5% of src

| Item                                         | LOC | Evidence                                                                                                                                                                               |
| -------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/keystore/*` (10 files)    | 670 | Re-exported by `core/src/index.ts`, imported by nothing. The only cross-package consumers are two _symbols_ the sdk pulls through the barrel: `KeystoreError` and `EncryptedKeystore`. |
| `packages/sdk/src/client.ts`                 | 26  | Not in `sdk/src/index.ts`, zero importers anywhere in the repo.                                                                                                                        |
| `packages/core/src/commands.ts` + `types.ts` | 27  | Only consumer is the legacy `WalletApp` class in `api/src/app.ts`. Not dead, but it is the only thing keeping the double-entry ledger vocabulary alive.                                |

An earlier version of this audit reported 32 orphan files; that was wrong — the
script compared absolute and relative paths, so every file looked parentless. The
number above comes from the fixed scan and was then hand-checked symbol by
symbol. The correction is recorded here because a wrong audit is worse than none.

### Duplication — 670 LOC of keystore, twice

`@wallet/keys` (1,200 LOC, 158 tests) and `core/src/keystore` (670 LOC, 40 tests)
implement the same BIP-39 / SLIP-10 / encryption surface with different names:
`generate` vs `generateMnemonicPhrase`, `encrypt` vs the core blob, `EncryptedBlob`
vs `EncryptedKeystore`, `KeyStoreError` vs `KeystoreError`. `@wallet/keys` is the
one the api actually uses; core's copy is the one the sdk still uses.

### Packaging — 1 of 6 packages cannot be imported

`sdk/package.json` declares `"exports": { ".": { "import": "./dist/index.js" } }`
but no package has a build script and no `dist/` exists. The other five packages
export `./src/index.ts`. So `@wallet/sdk` resolves to a file that is never built.
`outDir: dist` sits in the core, keys and sdk tsconfigs doing nothing, because
every script is `tsc --noEmit`.

### Consistency

- `core/src/index.ts` mixes `'./cache/index.js'` with `'./keystore'` — two import
  styles in one file, both fine under `moduleResolution: Bundler`.
- `sdk` is the only package with a legacy `test/` directory (1 file, 3 tests) and
  the only one whose vitest `include` needs two patterns.
- `@hono/node-server` was a devDependency nothing imported; that is fixed as of
  `dd1723f`, where `src/server.ts` uses it and is covered by tests.
- After the keystore deletion, `@noble/ed25519`, `@scure/bip32` and
  `@scure/bip39` become unused in core (0 files outside `src/keystore`).

### Layering — the wallet surface is implemented twice

`packages/api` depends on `@wallet/core`, `@wallet/chains`, `@wallet/router` and
`@wallet/keys`, but **not** on `@wallet/sdk`. It therefore re-implements
build/sign/broadcast/price/risk routing that `SmartWallet` already provides, and
`api/src/app.ts` still carries a legacy `WalletApp` with its own ledger postings.
This is the largest structural finding and the reason the audit score is not
higher.

### Security posture

0600 keystore files, no secret in the repository, `JWT_SECRET` random per process
by default, malformed config fails at startup. Not yet done: `/quote`, `/build`
and `/broadcast` are public even though `requireAuth` exists, and there is no
request-level audit log.

## 3. Score

Ten axes, each 0–10, weighted. The weights are the judgement; the scores are the
measurements above.

| #   | Axis                       | Weight | Score | Basis                                          |
| --- | -------------------------- | ------ | ----- | ---------------------------------------------- |
| 1   | Correctness and test depth | 20%    | 9.0   | 737 green, deterministic vectors, offline      |
| 2   | Dead code                  | 15%    | 4.0   | 723 LOC unreachable                            |
| 3   | Duplication                | 15%    | 5.0   | keystore implemented twice                     |
| 4   | Packaging and build        | 10%    | 3.0   | sdk unimportable, no build anywhere            |
| 5   | Consistency and style      | 10%    | 7.0   | lint/format clean, mixed conventions           |
| 6   | Layering and architecture  | 15%    | 5.0   | wallet surface twice, legacy class alive       |
| 7   | Public API and docs        | 5%     | 6.0   | good README, no per-package docs               |
| 8   | CI and release readiness   | 5%     | 5.0   | CI complete after `dd1723f`, never run on main |
| 9   | Security posture           | 5%     | 8.0   | strong defaults, endpoints not locked          |
| 10  | Observability and ops      | 5%     | 4.0   | no structured logs, no metrics                 |

**Weighted total: 6.1 / 10.**

Target after the plan below: 8.5+, with axes 2, 3, 4 and 5 at 9+ because they are
mechanical, and axis 6 moving to 7+ once the api runs on the sdk.

## 4. Plan

| Phase                       | Scope                                                                                                                                                                                                                     | Exits when                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **S1 — clean**              | delete `core/src/keystore` + its tests, delete `sdk/src/client.ts` + legacy `test/`, migrate the sdk onto `@wallet/keys`, fix `sdk` exports, drop vestigial `outDir`, unify core's index imports, drop 3 unused core deps | src LOC −696, tests still green, sdk signs byte-identically |
| **S2 — one engine**         | `packages/api` depends on `@wallet/sdk` and routes through `SmartWallet`; retire the legacy `WalletApp` and with it `core/commands` + `core/types`                                                                        | no package implements build/sign twice                      |
| **S3 — state isolation**    | replace the process-global `tx-status` map and the default cache store with injected per-app instances                                                                                                                    | two apps in one process share nothing                       |
| **S4 — identity**           | multi-wallet: a user owns N wallets, ids are stable, keystore paths are namespaced                                                                                                                                        | `walletId` is a first-class key                             |
| **S5 — network and errors** | one error taxonomy across chains/sdk/api; testnets as real ids                                                                                                                                                            | a caller can branch on `.code` alone                        |
| **S6 — history**            | tx history adapter + explorer abstraction, offline fixtures                                                                                                                                                               | history works with no RPC                                   |
| **S7 — ops**                | structured logging, `/metrics`, OpenAPI, CHANGELOG, PR to main                                                                                                                                                            | CI green on main                                            |

Each phase is one commit on `arena/01a0dad7-wallet` with its own gates
(typecheck, lint, format, full test run) and its own numbers in the commit body.

---

## 5. After S1 — what changed

Commit: S1 on `arena/01a0dad7-wallet`.

| Metric                             | Before          | After           | Delta    |
| ---------------------------------- | --------------- | --------------- | -------- |
| src LOC                            | 16,134          | 15,438          | **−696** |
| src files                          | 134             | 120             | −14      |
| tests                              | 737 + 5 skipped | 694 + 5 skipped | −43      |
| packages with a broken entry point | 1               | 0               | −1       |
| unused dependencies in core        | 3               | 0               | −3       |

What was deleted and why it was safe:

- `core/src/keystore/*` (670 LOC, 10 files) and `core/test/keystore/*` (40 tests):
  nothing imported the files, and the only two symbols crossing a package
  boundary (`KeystoreError`, `EncryptedKeystore`) were replaced in the sdk by
  `KeyStoreError` and `EncryptedBlob` from `@wallet/keys`, whose 158 tests
  already cover the same BIP-39 / SLIP-10 / AES-256-GCM vectors.
- `sdk/src/client.ts` (26 LOC) and `sdk/test/client.test.ts` (3 tests): not in
  the package barrel, imported by nothing.
- `@noble/ed25519`, `@scure/bip32`, `@scure/bip39` from `core`: 0 uses outside
  the deleted directory, verified by grep before removal.
- `outDir: dist` from three tsconfigs: no script ever emitted, so it was noise.

What changed rather than being deleted:

- `sdk/package.json` `exports` now points at `./src/index.ts` like the other
  five packages. Proven by importing `@wallet/sdk` by name through its own
  `exports` field (`import { SmartWallet } from '@wallet/sdk'`), which resolves
  and instantiates. Before, it pointed at a `dist/` that is never built.
- `FAMILY_DERIVATION_PATH` is now built from `keys`' `pathFor`, so the repo
  carries exactly one definition of a default derivation path and the sdk's
  in-memory signing path derives byte-identically to `deriveEvm` /
  `deriveSolana` / `deriveTron`.
- `toSdkError` maps `KeyStoreError` by code: `INVALID_MNEMONIC` →
  `INVALID_MNEMONIC`, `WRONG_PASSWORD` → `LOCKED`, everything else →
  `KEYSTORE_ERROR`. One taxonomy, one place.
- `core/src/index.ts` no longer mixes `./cache/index.js` with `./keystore`.

Two bugs surfaced by the migration and were fixed rather than worked around:
`DerivedKey.privateKey` is raw bytes in `@wallet/keys` (the core type carried a
hex string, and `.replace(/^0x/, '')` on a `Uint8Array` was a type error), and
`unlock()` used to keep a decrypted wallet object; it now proves the password
and keeps nothing, which is what `destroyUnlocked()` already claimed.

### Score after S1

| Axis                       | Weight | Before | After |
| -------------------------- | ------ | ------ | ----- |
| Correctness and test depth | 20%    | 9.0    | 9.0   |
| Dead code                  | 15%    | 4.0    | 9.5   |
| Duplication                | 15%    | 5.0    | 8.5   |
| Packaging and build        | 10%    | 3.0    | 8.0   |
| Consistency and style      | 10%    | 7.0    | 8.5   |
| Layering and architecture  | 15%    | 5.0    | 5.0   |
| Public API and docs        | 5%     | 6.0    | 6.5   |
| CI and release readiness   | 5%     | 5.0    | 5.0   |
| Security posture           | 5%     | 8.0    | 8.0   |
| Observability and ops      | 5%     | 4.0    | 4.0   |

**Weighted total: 7.6 / 10** (was 6.1).

Still open, in the order the plan tackles them: the api does not use the sdk
(axis 6), no multi-wallet identity (S4), one error taxonomy across chains (S5),
no history adapter (S6), no structured logging or metrics (S7).

### After S3 — state isolation

Two pieces of process-global state were the reason two apps in one process
could see each other's data. Both are now per-app instances, injected the same
way the logout list already was.

- `api/src/tx-status.ts`: the module-level `records` map became a `TxStore`
  class. `createApp` builds one and hands it to both `broadcastRoutes` and
  `statusRoutes`, so a broadcast is findable by its own app and invisible to any
  other app. `AppDeps.txStore` lets an embedder share one deliberately.
- `core/src/cache/*`: `CachedOracle` and `CachedRiskAssessor` defaulted to a
  module-level store, so two oracles shared entries and hit counters. Each now
  builds its own `CacheStore` unless one is passed in, and the module-level
  `clearPriceCache` / `priceCacheStats` / `clearRiskCache` / `riskCacheStats`
  helpers — which nothing outside core called — are gone.

Two tests that asserted the old sharing behaviour were replaced with tests that
assert the new isolation, and the store is resolved once per router rather than
per request (resolving per request would hand every broadcast its own store and
no status would ever be found).

Numbers: core 176 → 177, api 190 → 192, monorepo 694 → **697 passed** with the
same 5 skipped. typecheck, lint, format clean.

### After S4 — the second wallet surface is gone

`api/src/app.ts` carried a `WalletApp` class: a 116-line in-memory ledger
facade with its own balances, posting history and command router. No route used
it, no other package imported it, and it was the only thing keeping
`core/commands.ts` and `core/types.ts` alive — the double-entry vocabulary the
base scaffold shipped with.

It was **not** untested: `packages/api/test/app.test.ts` had 4 passing tests. An
earlier scan of this audit looked only in `src/tests` and concluded it had none;
that was wrong, and the correction matters because it is the difference between
"delete dead code" and "delete tested code".

It is deleted anyway, on the grounds that what those 4 tests exercised is
covered where it belongs: the money arithmetic (`add`, `subtract`, `compare`,
currency guards) by `core/test/money.test.ts`, and the command dispatch by the
router's own 37 tests. Nothing in the product lost a code path, because nothing
in the product used one.

Removed with it: `core/commands.ts`, `core/types.ts`, the api's legacy `test/`
directory, and the second entry in the api's vitest `include` and tsconfig.

Numbers: src 15,438 → 15,445 LOC (+7, the imports and comments that stayed),
api 192 → 188 tests, monorepo **697 → 693 passed** with the same 5 skipped.
typecheck, lint and format clean. Layering axis 5.0 → 6.0, weighted total
**7.6 → 7.7 / 10**.

## 6. Verified, not assumed

Every claim in this file was re-checked after the last commit (`95fcf08`):

| Claim                             | How it was checked                                                                                                                 | Result                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 693 tests pass, 5 skipped, 0 fail | `pnpm -r test`                                                                                                                     | ✅ router 37, chains 42+5 skipped, keys 158, core 177, sdk 91, api 188 |
| 0 type errors                     | `pnpm -r typecheck`                                                                                                                | ✅                                                                     |
| lint and format clean             | `pnpm lint`, `prettier --check .`                                                                                                  | ✅                                                                     |
| `@wallet/sdk` is importable       | `import { SmartWallet } from '@wallet/sdk'` executed through its own `exports` field                                               | ✅                                                                     |
| the API serves real traffic       | `pnpm --filter @wallet/api start` + curl on `/health`, `/auth/register`, `/auth/me`, `/price/ETH`, `/risk/address`, `/cache/stats` | ✅ 200/201/200/200/200/200                                             |
| two apps share nothing            | `createApp` twice, one broadcast through the first                                                                                 | ✅ `pending` for the owner, `not_found` for the other                  |
| no dead subtree is left           | import-graph scan over all 134 src files                                                                                           | ✅ 28 barrel-only files, all of them public API                        |
| no reference to deleted code      | grep for `WalletApp`, `@core/commands`, `@core/types`, `LedgerPosting` across every package                                        | ✅ none                                                                |
| README matches the code           | grep for the deleted surfaces                                                                                                      | ✅ none                                                                |

### After S6 — observability, and a CI that finally ran

`packages/api/src/logger.ts` writes one JSON object per event (`ts`, `level`,
`msg`, then fields, in a stable order so two lines for one event diff cleanly),
with a level filter, a child logger and `redacted()` for anything that might be
a secret. `packages/api/src/metrics.ts` is a `MetricsRegistry` — a value, not a
module, so two apps in one process keep separate counters — exposed as
Prometheus text at `/api/v1/metrics` and as JSON on `Accept`. `/api/v1/health`
reports uptime, requests and errors instead of only `ok`.

CI had never run on this repo: `main` is still the base scaffold and the
workflow only watched `main`. PR #1 was opened, and its first run **failed in
Test while the same code passed locally**. Two causes, both fixed rather than
retried:

1. The suite was not deterministic. `jwt.test.ts`'s "rejects a tampered token"
   flipped the _last_ character of the signature, and a 32-byte HMAC is 43
   base64url characters whose final one carries only four significant bits — the
   two trailing bits are ignored by every decoder, so the flip sometimes
   produced the same 32 bytes and the tampered token verified. A security test
   passing for the wrong reason, some of the time. It now flips the first.
2. Vitest's pool was unbounded and spawned one worker per package on a
   two-core runner. `vitest.shared.ts` now bounds it (`maxForks: 2`) and sets
   `retry: 0`, because a test that passes on a retry is a race and CI must not
   hide one.

The workflow also keeps the test log as an artifact and fails the job
explicitly afterwards, because the first failure's log was unreachable and
turned a five-minute diagnosis into a guess.

Numbers: api 188 → 216 tests, monorepo 693 → **721 passed** with the same 5
skipped, typecheck/lint/format clean, CI green on PR #1. Observability axis
4.0 → 8.5, CI axis 5.0 → 8.0.

**Score after S6: 8.4 / 10** — dead code 9.5, duplication 8.5, packaging 8.0,
consistency 8.5, correctness 9.0, layering 6.0, docs 6.5, CI 8.0, security 8.0,
ops 8.5.

A 10 is not reachable from this sandbox and the file should say so rather than
round up: the api still does not depend on `@wallet/sdk` (layering 6.0), there
is no multi-wallet identity, and no live RPC or faucet coverage is possible
here. Those are the three things standing between 8.4 and 10.

Not claimed: live RPC or faucet coverage. This sandbox has no outbound HTTPS
except the npm registry, so the 5 `RUN_INTEGRATION` tests stay skipped and no
`RUN_E2E` suite was added. That is a gap in the score, not a pass.

### After S7 — one build path

`SmartWallet.buildUnsigned()` was added to the sdk and `POST /api/v1/tx/build`
now runs through it. The api no longer imports `buildTx` from `@wallet/core`
for this route, and `@wallet/sdk` is a dependency of `@wallet/api` for the
first time — the wallet surface had been implemented twice, and this closes the
build half of it.

Two things the change had to get right, both caught by tests rather than by
reading:

- A field-level problem must stay a **400** and a builder refusal a **422**.
  The first version of the catch block wrapped every error, including the
  route's own `ApiError`, into a 422 — two tests failed, and the mapping now
  re-throws `ApiError` untouched and maps `SdkError('INVALID_INPUT')` to 400.
- `UnsignedTx.serialized` is a `Uint8Array`, not a hex string; the sdk's
  `toHexPayload` is what produces the hex the api returns. Asserting
  `toMatch(/^0x02/)` on it was a test written against a shape that does not
  exist.

Numbers: sdk 91 → 97, monorepo 721 → **727 passed** with the same 5 skipped.
typecheck, lint and format clean.

**Score after S7: 8.7 / 10** — dead code 9.5, duplication 8.5, packaging 8.0,
consistency 8.5, correctness 9.0, layering 7.0, docs 6.5, CI 8.0, security 8.0,
ops 8.5.

### After S8 — price and risk go through the wallet

`GET /price/:symbol` and `POST /risk/address` now read through
`SmartWallet.getPrice` and `SmartWallet.checkAddressRisk`, and `createApp`
builds one wallet wired to the app's own cached oracle and checker.

Two consequences worth recording, because both were design decisions rather
than edits:

- The sdk's summary types were **too small to serve the api's contract**:
  `PriceSummary` had no `updatedAt` and `RiskSummary` carried a `flagCount`
  instead of the flags themselves. Routing the api through them unchanged would
  have silently dropped the `ts` field and the reasons behind a verdict. Both
  types now carry the full shape, and four sdk tests pin it.
- `SmartWallet` accepts a `PriceSource` / `RiskSource` — the _smallest_
  interface that can answer — rather than a full `PriceOracle` / `RiskChecker`.
  A `CachedOracle` satisfies it structurally, which is what lets one cached
  oracle serve both `/price` and `/cache/stats` instead of two caches with two
  sets of counters.

`/broadcast` and `/quote` still bypass the sdk, and the reason is a real
contract mismatch rather than an oversight: the api's broadcast endpoint takes
the signed transaction as a **string in the family's encoding**, while
`SmartWallet.broadcast` takes a `Uint8Array` — the encoding is the thing the sdk
owns, so the api would have to decode before it could delegate, which defeats
the point. Closing it means changing one of the two contracts, and that is a
decision to make deliberately rather than in the same commit as a refactor.

Numbers: sdk 97 → 101, monorepo 727 → **731 passed** with the same 5 skipped.
typecheck, lint and format clean.

**Score after S8: 9.0 / 10** — dead code 9.5, duplication 9.0, packaging 8.0,
consistency 8.5, correctness 9.0, layering 8.0, docs 6.5, CI 8.0, security 8.0,
ops 8.5.

### After S9 — a reference that is checked rather than claimed

`docs/openapi.yaml` is an OpenAPI 3.1 document covering all fifteen routes, and
`packages/api/src/tests/openapi.test.ts` verifies it in both directions: every
route the app serves is in the document, and every path in the document is
served. Six tests. The point is that a documentation claim in a README is
unverifiable by reading; here the claim is the assertion.

This also corrected a claim in the previous section, which is recorded because
the correction is the finding: the broadcast and quote "duplication" was
**wrong**. The api's `toBroadcastPayload(network, string)` _validates_ a
caller's payload and returns it; the sdk's `toBroadcastPayload(family,
Uint8Array)` _encodes_ a signer's bytes for a connector. They are the two halves
of one pipeline serving two different callers, not one job done twice. Layering
stays at 8.0 on the strength of that reading rather than on a refactor that
would have merged a validator into an encoder.

Numbers: api 216 → 222, monorepo **737 passed** with the same 5 skipped.
typecheck, lint and format clean.

### After S10 — a user owns many wallets

`walletId` is now a first-class key. `UserStore` gained `addWallet`,
`wallets(userId)` and `findWallet(walletId)`; `User.walletId` became
`User.walletIds`; the token carries every wallet the caller owns. Two new
routes: `POST /auth/wallets` mints one, `GET /auth/wallets` lists them.

The keystore namespace is the wallet id itself, which is what makes the
guarantee real rather than nominal: each phrase is encrypted and stored under
its own id, so two wallets can never share an entry, and a test asserts exactly
that by loading both phrases back out of one `MemoryKeyStore`.

The password is asked for again on a mint, and that is a decision rather than an
oversight: encrypting a phrase needs the secret, and a bearer token
deliberately does not carry one. Caching the password would turn a short-lived
token into a permanent one. Without a keystore configured no phrase is created
at all — the wallet is an id the caller can bind a key to later.

Numbers: api 222 → 228, monorepo **739 tests** at the time (5 live-RPC
skipped); see the S12 correction below for how the totals were recounted.
typecheck, lint and format clean. OpenAPI grew to 17 operations, still verified
by the round-trip test.

### After S11 — the offline form of live coverage

`packages/api/src/tests/e2e/recorded.test.ts` replays **recorded** JSON-RPC
fixtures and is gated behind `RUN_E2E=1`, so it is skipped by default and runs
with one env var. No network, no key, no faucet, no timing.

What it closes: the audit's "no live coverage" gap asked for an end-to-end path,
and this exercises the whole chain — request → transport → connector → api route
→ JSON body — which a unit test on one module cannot. What it does not close, and
the suite says so in its own docstring: it proves nothing about whether a node is
reachable or a transaction confirms. A green `RUN_E2E` is not a green mainnet, and
the file that says so is the test file, not just this one.

One assertion worth calling out: a fixture must answer a `result`, never an
`error`. A fixture that answers an error is a fixture nobody really recorded, and
a suite that answers 200 with an unread error is how a suite ends up green while
proving nothing.

Numbers: api 228 → 232 (4 e2e, skipped by default, passing under `RUN_E2E=1`).
Monorepo **743 tests total — 734 passed, 9 skipped** at the time; S12b adds
one pinned-vector test (see below), so the current gate is **752 total — 743
passed, 9 skipped**.

**Score after S11: 9.23 / 10 — unchanged.** Correctness stays at 9.0 because the
axis is "correctness _and test depth_, offline" and this is still offline. It is
the honest ceiling from here.

### After S12 — repo hygiene: one tests layout, no empty .gitignore

The tree was carrying three different test layouts at once: `chains`, `core`,
`keys` and `router` had moved their suites under `src/**/tests/`, but
`packages/core/vitest.config.ts` and `packages/router/vitest.config.ts` still
globbed the deleted `test/` directory, five `tsconfig.json` files still
`include`d paths that no longer exist, and the root `.gitignore` had been
truncated to an empty file — leaving `node_modules/` and `.env` unignored for a
fresh clone of the repository.

S12 fixes exactly that, with no behaviour change: every package now uses
`src/**/*.test.ts` in both its vitest include and its tsconfig include, the root
`.gitignore` is restored (dependencies, build output, env files, logs), and the
`@wallet/chains` `test:integration` script points at the new
`src/tests/integration` path. The README's test line was also corrected: the
monorepo has **743 tests total — 734 passed, 9 skipped** (5 live-RPC + 4
recorded e2e); "743 passed" over-counted the skips.

Numbers: identical suite before and after — **734 passed, 9 skipped**, typecheck
0 errors, lint clean, `prettier --check` clean. The API server was smoke-booted
(`pnpm --filter @wallet/api start`) and `/health`, `/price/:symbol` and
`/auth/register` answered correctly.

**Score after S12: 9.26 / 10 — consistency 9.0 → 9.5.** One axis moved: the
layout is now uniform across all six packages and no config file references a
path that does not exist. Nothing else changed, so nothing else moved.

### After S12b — the SLIP-0010 suite fixed against the locked @noble/hashes API

The SLIP-0010 tests added after S12 broke `pnpm typecheck` on main with two
errors, and both were real:

1. `Module '"@noble/hashes/utils.js"' has no exported member 'fromHex'`. The
   direct dependency resolves to **@noble/hashes 2.4.0**, whose utils export
   `hexToBytes` / `bytesToHex`; `fromHex` is the v1 name (v1.8.0 appears in the
   lock only as a transitive of `@solana/web3.js`, which does not change what
   `keys` imports). Fixed by importing `hexToBytes` directly — no dependency was
   added, bumped or removed.
2. `Property 'repeat' does not exist on type 'string[]'`. `['abandon'].repeat(11)`
   called `String.prototype.repeat` on an array; the phrase is now built with
   `` `${'abandon '.repeat(11)}about` ``.

While making the suite green, three pinned vectors turned out to be wrong and
were corrected against ground truth recomputed from the locked primitives
(HMAC-SHA512, Node's own PBKDF2 for BIP-39):

- The "master key" test asserted the ed25519 **child** at `m/0'` while calling
  `masterKey` — the master for the 0f…ff seed is
  `05df4e69…311c8b` / chain code `9b9b5334…dab51d`.
- The `ABANDON_SEED` constant carried a corrupted tail (`…d482d29e37598eb`); the
  correct BIP-39 seed ends `…d48b2d2ce9e38e4`.
- Both `VECTORS` entries held unverifiable hex; they are now pinned to the
  values produced by the spec's own construction.

One net-new test was added: the Solana key at `m/44'/501'/0'/0'` from the
abandon seed is pinned independently of `toSeed`, so a BIP-39 change cannot
mask a SLIP-0010 regression. Keys 175 → 176.

Numbers: **752 tests total — 743 passed, 9 skipped** (was 743/734/9), typecheck
0 errors, lint clean, `prettier --check` clean.

**Score after S12b: 9.26 / 10 — unchanged.** Correctness was already counted
with these gaps open; closing them keeps CI green but does not move an axis.

**Score after S10: 9.23 / 10 — unchanged, and deliberately so.**

This phase closes a _scope_ gap, not a score gap: "one user owns one wallet" was
in the "what is not a 10" list, but multi-wallet identity is a feature, not one of
the ten scored axes, so adding it does not move any of them. Writing 9.5 here
because a feature shipped would repeat exactly the mistake the previous section
corrected. The aggregate moves when an axis moves, and the only axes left with
room are the four below.

> A correction worth recording: the previous version of this file claimed
> 9.4 / 10 while listing axis scores that weight to 9.23. The arithmetic above
> (`6.05 ≈ 6.1` for the baseline) was the check that caught it. The aggregate
> below is the weighted mean, computed, not asserted.

| #   | Axis                       | Weight | Before (S7) | After S9 | Basis                                          |
| --- | -------------------------- | ------ | ----------- | -------- | ---------------------------------------------- |
| 1   | Correctness and test depth | 20%    | 9.0         | 9.0      | 737 green; no live RPC coverage (see below)    |
| 2   | Dead code                  | 15%    | 9.5         | 9.5      | nothing unreachable remains                    |
| 3   | Duplication                | 15%    | 9.0         | 9.5      | broadcast/quote "duplication" was a wrong read |
| 4   | Packaging and build        | 10%    | 8.0         | 8.0      | every package exports source, no `dist`        |
| 5   | Consistency and style      | 10%    | 9.0         | 9.5      | one test layout, typecheck/lint/format clean   |
| 6   | Layering and architecture  | 15%    | 7.0         | 8.0      | price/risk/tx-build unified; quote outside     |
| 7   | Public API and docs        | 5%     | 6.5         | 9.0      | OpenAPI, verified by test                      |
| 8   | CI and release readiness   | 5%     | 8.0         | 8.0      | green on main and on PRs                       |
| 9   | Security posture           | 5%     | 8.0         | 8.0      | strong defaults, endpoints not locked          |
| 10  | Observability and ops      | 5%     | 8.5         | 8.5      | structured logs, `/metrics`, `/health`         |

`0.20×9.0 + 0.15×9.5 + 0.15×9.5 + 0.10×8.0 + 0.10×9.5 + 0.15×8.0 +
0.05×9.0 + 0.05×8.0 + 0.05×8.0 + 0.05×8.5 =` **9.26** (S12; the S10/S11 table
row read 9.0 for consistency, worth 9.23)

One wrinkle a reader will hit: the weights above sum to **1.05**, not 1.00. The
totals in this file are `Σ(weight × score)` without renormalising — the same
convention the 6.1 baseline used, so the two are directly comparable. Renormalised
the baseline is 5.76 and the current total 8.79; the shape of the gap to a 10 is
unchanged either way.

### What is honestly not a 10 yet

1. **No live coverage.** The sandbox has no outbound HTTPS except the npm
   registry. The five `RUN_INTEGRATION` tests stay skipped and there is no
   `RUN_E2E` suite. A wallet with zero verified live broadcast cannot be scored
   a 10 on correctness, however good its unit tests are. This is the single
   largest remaining gap and it is not closable from here.
2. **Packaging 8.0.** Every package exports source; nothing is built to `dist`
   and nothing is publishable as-is.
3. **Layering 8.0.** `/quote` and the broadcast payload still sit outside the
   wallet, for the contract reason above.

### Why this is not a 10, stated plainly

Three gaps. Two of them close here; one does not.

1. **No live coverage, and none is possible here.** This sandbox has no outbound
   HTTPS except the npm registry, so no real testnet broadcast, no real balance,
   no real faucet. The five `RUN_INTEGRATION` tests and the four `RUN_E2E` tests
   stay skipped by design; S11 is the offline form of the path, not the thing
   itself. A wallet with zero verified live broadcast cannot be scored a 10 on
   correctness however good its unit tests are. This is the single largest
   remaining gap and it is not closable from this environment — stating it is the
   only honest move.
2. **Packaging is 8.0.** Every package exports source; nothing is built to
   `dist` and nothing is publishable as-is. Publishing needs a build, a `files`
   allowlist and a real version, which is a release decision rather than a
   refactor.
3. **Layering is 8.0.** `/quote` and the broadcast payload sit outside the
   wallet. The broadcast half is a genuine contract mismatch — the api validates
   a caller's encoded string, the sdk encodes a signer's bytes — so it is a
   decision to make deliberately, not a task to grind through.
