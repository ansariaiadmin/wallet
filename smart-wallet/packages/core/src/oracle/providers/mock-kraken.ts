import type { PriceProvider } from '../types';
import { createMockProvider, type MockPrice } from './mock';

const PRICES: Readonly<Record<string, MockPrice>> = {
  ETH: { usdPrice: 3210.0, change24hBps: 155 },
  BTC: { usdPrice: 62100.0, change24hBps: -225 },
  SOL: { usdPrice: 145.8, change24hBps: 85 },
  TRX: { usdPrice: 0.1185, change24hBps: 15 },
  USDC: { usdPrice: 0.9999, change24hBps: 0 },
  USDT: { usdPrice: 0.9998, change24hBps: 1 },
};

/** Deterministic Kraken-style feed; it lists neither MATIC nor BNB. */
export const mockKrakenProvider: PriceProvider = createMockProvider('mock-kraken', PRICES);
