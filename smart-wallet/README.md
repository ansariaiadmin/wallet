# Smart Wallet

Monorepo for the Smart Wallet platform — a pnpm workspace with four packages:
`core` (domain), `router` (dispatch), `api` (application surface) and `sdk` (client).

## Layout

```
smart-wallet/
├── packages/
│   ├── core/     # domain primitives: money, ledger postings, commands, errors,
│   │             # plus the keystore (BIP-39, BIP-32, SLIP-0010 ed25519, AES-256-GCM)
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

## CI

`.github/workflows/ci.yml` runs lint + test on every push and pull request to
`main`.
