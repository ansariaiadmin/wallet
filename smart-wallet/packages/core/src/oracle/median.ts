/**
 * Returns the median of `values`: the middle element of the sorted list for an
 * odd count, the average of the two middle elements for an even count.
 *
 * Pure function — no dependencies, no side effects, input untouched.
 *
 * @throws Error when `values` is empty.
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median() requires at least one value');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const odd = sorted[middle];
    if (odd === undefined) {
      throw new Error('median() could not read the middle element');
    }
    return odd;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) {
    throw new Error('median() could not read the two middle elements');
  }
  return (lower + upper) / 2;
}
