/**
 * Sentinel addresses standing for the native asset of a family, so callers do
 * not have to special-case "ETH", "SOL" or "TRX" in their own code.
 */

/** Native asset placeholder on EVM chains (ETH, and every L2's gas token). */
export const NATIVE_EVM = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** Wrapped-SOL mint, the universal Solana native-token sentinel. */
export const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

/** TRX sentinel used by the TRON aggregators. */
export const NATIVE_TRON = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
