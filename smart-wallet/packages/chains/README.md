# @wallet/chains

Multi-chain RPC connectivity layer: query balances, estimate fees and broadcast
already-signed transactions on EVM, Solana and TRON.

This package never touches private keys, mnemonics or seed phrases — it only
reads chain state and forwards signed payloads. Transaction _building_ and
signing live in a later phase.

## Supported chains

| Family | Chains                                                               |
| ------ | -------------------------------------------------------------------- |
| EVM    | ethereum, polygon, base, arbitrum, optimism, bsc (mainnet + testnet) |
| Solana | solana (mainnet-beta + devnet)                                       |
| TRON   | tron (mainnet + Nile/Shasta testnets)                                |

Every chain ships with an ordered endpoint list: the first entry is the
primary, the rest are fallbacks used by the retry policy.

## Usage

```ts
import { createConnector } from '@wallet/chains';

const eth = createConnector('ethereum', { network: 'testnet' });
// or with custom endpoints (order = priority) and a custom retry policy
const sol = createConnector('solana', {
  rpcUrls: ['https://api.devnet.solana.com', 'https://my-own-node.example'],
  retry: { attempts: 3, delayMs: 200, timeoutMs: 15_000 },
});

// native balance
const ethBalance = await eth.getNativeBalance('0x00000000219ab540356cBB839Cbe05303d7705Fa');
// → { unit: 'native', symbol: 'ETH', decimals: 18, amount: 123n, formatted: '0.000…' }

// token balances (ERC-20 / SPL / TRC-20)
const usdt = await eth.getTokenBalances(address, ['0xdAC17F958D2ee523a2206206994597C13D831ec7']);
const spl = await sol.getTokenBalances(address); // enumerates SPL + Token-2022

// worst-case cost before signing
const fee = await sol.estimateFee({ from, to, amount: 1_000_000n });
// → { units: 1n, unitPrice: 5000n, maxCost: 5000n, formattedMaxCost: '0.000005' }

// broadcast a signed payload, get the hash back
const result = await eth.broadcast(signedSerializedTransaction);
// → { chainId: 'ethereum', txHash: '0x…', explorerUrl: 'https://sepolia.etherscan.io/tx/0x…' }
```

EVM broadcasts accept the `0x`-prefixed serialized transaction, Solana accepts
base64 or `0x`-hex of the signed transaction, and TRON accepts the signed
transaction object as a JSON string (that is what TronGrid expects).

## Failure handling

All three families share one policy (`src/transport.ts`):

- per-endpoint retries with exponential backoff (`attempts`, `delayMs`);
- sequential fallback to the next endpoint, so one dead node never fails a call;
- a per-request timeout (`timeoutMs`);
- `AllRpcEndpointsFailedError` once every endpoint is exhausted, carrying the
  per-endpoint failures;
- a node that _rejects_ a request (JSON-RPC error object) is a verdict, not a
  fault, so broadcasts surface it immediately as `BroadcastError` with the
  node's own message instead of retrying every endpoint.

## Notes per family

- **EVM** — viem `PublicClient` per call. ERC-20 enumeration needs an indexer,
  so `getTokenBalances` without a token list returns `[]`. Fee estimates use
  `eth_estimateGas` + `estimateFeesPerGas`; L1 data fees (and gas refunds) are
  excluded from `maxCost`.
- **Solana** — `@solana/web3.js` `Connection`. Token accounts are read for both
  the classic SPL Token program and Token-2022. Fees come from
  `getFeeForMessage` over a `SystemProgram.transfer` message; the ATA rent
  deposit is not part of the fee.
- **TRON** — hand-rolled TronGrid REST calls (no tronweb dependency): sun
  balances via `/wallet/getaccount`, TRC-20 via `triggerconstantcontract`, and
  fees modelled as 265 bandwidth units for TRX and 345 bandwidth +
  `energy_used × energy price` for TRC-20.

## Tests

```bash
pnpm test                 # unit tests against a local mock node (offline)
pnpm test:integration     # live public testnet RPC (opt-in)
```

- `test/unit/` — 41 tests against a local HTTP mock that speaks JSON-RPC and
  TronGrid REST: balances, token balances, fee estimation, broadcast success and
  rejection, retry/fallback, address validation and the registry.
- `test/integration/` — read-only checks against public testnet endpoints,
  skipped unless `RUN_INTEGRATION=1` is set (public endpoints rate limit and
  change URLs; a live broadcast needs a funded account, which this layer never
  holds).
