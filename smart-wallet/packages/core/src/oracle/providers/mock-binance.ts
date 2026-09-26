import type { PriceProvider } from '../types';
import { createMockProvider, type MockPrice } from './mock';

const PRICES: Readonly<Record<string, MockPrice>> = {
  ETH: { usdPrice: 3195.0, change24hBps: 145 },
  BTC: { usdPrice: 61950.0, change24hBps: -215 },
  SOL: { usdPrice: 144.5, change24hBps: 75 },
  TRX: { usdPrice: 0.1175, change24hBps: 9 },
  USDC: { usdPrice: 1.0001, change24hBps: 2 },
  USDT: { usdPrice: 1.0002, change24hBps: 5 },
  BNB: { usdPrice: 419.5, change24hBps: 255 },
};

/** Deterministic Binance-style feed; it does not list MATIC. */
export const mockBinanceProvider: PriceProvider = createMockProvider('mock-binance', PRICES);
