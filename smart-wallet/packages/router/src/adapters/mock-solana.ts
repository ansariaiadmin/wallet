import type { AggregatorAdapter } from '../types';
import { mockQuote, mockSupports } from './mock';

/** Mock Jupiter-style adapter: quotes Solana swaps only. */
export const mockSolanaAdapter: AggregatorAdapter = {
  name: 'mock-jupiter',
  supportedFamilies: ['solana'],
  supports: (req) => mockSupports('solana', req),
  quote: async (req) => mockQuote('mock-jupiter', req),
};
