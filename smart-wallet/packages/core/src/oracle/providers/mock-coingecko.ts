import type { PriceProvider } from '../types';
import { createMockProvider, type MockPrice } from './mock';

const PRICES: Readonly<Record<string, MockPrice>> = {
  ETH: { usdPrice: 3200.0, change24hBps: 150 },
  BTC: { usdPrice: 62000.0, change24hBps: -220 },
  SOL: { usdPrice: 145.0, change24hBps: 80 },
  TRX: { usdPrice: 0.118, change24hBps: 12 },
  USDC: { usdPrice: 1.0, change24hBps: -1 },
  USDT: { usdPrice: 1.0, change24hBps: 3 },
  MATIC: { usdPrice: 0.88, change24hBps: -450 },
  BNB: { usdPrice: 420.0, change24hBps: 260 },
};

/** Deterministic CoinGecko-style feed covering all eight tracked symbols. */
export const mockCoinGeckoProvider: PriceProvider = createMockProvider('mock-coingecko', PRICES);
