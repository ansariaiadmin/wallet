import type { AggregatorAdapter } from '../types';
import { mockQuote, mockSupports } from './mock';

/** Mock SunSwap-style adapter: quotes TRON swaps only. */
export const mockTronAdapter: AggregatorAdapter = {
  name: 'mock-sunswap',
  supportedFamilies: ['tron'],
  supports: (req) => mockSupports('tron', req),
  quote: async (req) => mockQuote('mock-sunswap', req),
};
