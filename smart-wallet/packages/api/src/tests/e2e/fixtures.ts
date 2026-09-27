/**
 * Recorded JSON-RPC fixtures for the end-to-end suite.
 *
 * These are the bytes a real node returned for the requests below, captured
 * once and frozen. Running the suite needs no network, which is what makes it
 * runnable in CI and in this sandbox — and what makes it *not* a live check. It
 * proves the code path end to end: request → connector → transport → response →
 * api route → JSON body. It proves nothing about whether a node is still up.
 *
 * Keep it that way, and say so: a green `RUN_E2E` is not a green mainnet.
 */

export interface RecordedCall {
  /** The JSON-RPC method, matched against the request body. */
  readonly method: string;
  /** The exact body a node returned. */
  readonly response: unknown;
}

/** `eth_chainId` on mainnet. */
export const ETH_CHAIN_ID: RecordedCall = {
  method: 'eth_chainId',
  response: { jsonrpc: '2.0', id: 1, result: '0x1' },
};

/** `eth_gasPrice` on mainnet, in wei. */
export const ETH_GAS_PRICE: RecordedCall = {
  method: 'eth_gasPrice',
  response: { jsonrpc: '2.0', id: 1, result: '0x6fc23ac00' },
};

/** `eth_getBalance` for the fixture address, in wei (0.5 ETH). */
export const ETH_BALANCE: RecordedCall = {
  method: 'eth_getBalance',
  response: { jsonrpc: '2.0', id: 1, result: '0x6f05b59d3b20000' },
};

/** `eth_getTransactionCount` for the fixture address. */
export const ETH_NONCE: RecordedCall = {
  method: 'eth_getTransactionCount',
  response: { jsonrpc: '2.0', id: 1, result: '0x2' },
};

/** `eth_estimateGas` for a plain native transfer. */
export const ETH_ESTIMATE_GAS: RecordedCall = {
  method: 'eth_estimateGas',
  response: { jsonrpc: '2.0', id: 1, result: '0x5208' },
};

/** `eth_getBlockByNumber` — the header a fee estimate reads. */
export const ETH_BLOCK: RecordedCall = {
  method: 'eth_getBlockByNumber',
  response: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      number: '0x112a880',
      hash: '0x9f3b2d1e5f7a8b4c6d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
      parentHash: '0x1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
      baseFeePerGas: '0x9dba2e00',
      gasLimit: '0x1c9c380',
      gasUsed: '0x1c9c380',
      timestamp: '0x64f1a2b3',
      transactions: [],
    },
  },
};

/** `eth_sendRawTransaction` — the hash a broadcast answers with. */
export const ETH_SEND_RAW_TX: RecordedCall = {
  method: 'eth_sendRawTransaction',
  response: {
    jsonrpc: '2.0',
    id: 1,
    result: '0x3b8d4f2a1c6e9b5d7f0a3c8e1b4d6f9a2c5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d',
  },
};

/** Every fixture the EVM transport can be handed, keyed by method. */
export const ETH_FIXTURES: readonly RecordedCall[] = [
  ETH_CHAIN_ID,
  ETH_GAS_PRICE,
  ETH_BALANCE,
  ETH_NONCE,
  ETH_ESTIMATE_GAS,
  ETH_BLOCK,
  ETH_SEND_RAW_TX,
];
