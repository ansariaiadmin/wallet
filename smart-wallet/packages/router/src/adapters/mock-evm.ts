import type { AggregatorAdapter } from '../types';
import { mockQuote, mockSupports } from './mock';

/** Mock 1inch-style adapter: quotes EVM swaps only. */
export const mockEvmAdapter: AggregatorAdapter = {
  name: 'mock-1inch',
  supportedFamilies: ['evm'],
  supports: (req) => mockSupports('evm', req),
  quote: async (req) => mockQuote('mock-1inch', req),
};
