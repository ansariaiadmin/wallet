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
