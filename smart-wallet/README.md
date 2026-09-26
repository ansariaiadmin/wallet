# Smart Wallet

Monorepo for the Smart Wallet platform — a pnpm workspace with four packages:
`core` (domain), `router` (dispatch), `api` (application surface) and `sdk` (client).

## Layout

```
smart-wallet/
├── packages/
│   ├── core/     # domain primitives: money, ledger postings, commands, errors,
│   │             # plus the keystore (BIP-39, BIP-32, SLIP-0010 ed25519, AES-256-GCM)
│   ├── chains/   # multi-chain RPC layer: EVM (viem), Solana (web3.js), TRON (TronGrid)
│   ├── router/   # typed route → handler registry
│   ├── api/      # wallet application surface wired on top of core + router
│   └── sdk/      # typed client over an injectable transport
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

| Alias       | Resolves to             |
| ----------- | ----------------------- |
| `@core/*`   | `packages/core/src/*`   |
| `@router/*` | `packages/router/src/*` |
| `@api/*`    | `packages/api/src/*`    |
| `@sdk/*`    | `packages/sdk/src/*`    |
| `@chains/*` | `packages/chains/src/*` |

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

## CI

`.github/workflows/ci.yml` runs lint + test on every push and pull request to
`main`.
