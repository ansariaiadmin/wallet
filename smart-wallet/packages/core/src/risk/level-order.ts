import type { RiskLevel } from './types';

/** Numeric weight of every level, used for sorting and comparisons. */
const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/**
 * Returns the sort weight of `level`.
 *
 * @throws Error when `level` is not a known {@link RiskLevel}.
 */
export function riskLevelOrder(level: RiskLevel): number {
  // Guarded read: an unknown level must fail loudly, not sort as 0.
  const order = RISK_ORDER[level];
  if (order === undefined) {
    throw new Error(`Unknown risk level: ${String(level)}`);
  }
  return order;
}

/** Returns the most severe level of `levels`, or `none` for an empty list. */
export function highestRiskLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.length === 0) {
    return 'none';
  }
  return levels.reduce((max, current) =>
    riskLevelOrder(current) > riskLevelOrder(max) ? current : max,
  );
}
