/**
 * What may be claimed in the per-item flow (promise 9, ADR 0010's lowest cart rung).
 *
 * On that rung Kaniti fills nothing: the family taps "add" on the store's own product page. The only
 * evidence an item went in is the store's own basket number rising while that page was on screen. So
 * the rule is deliberately one-directional — a rise verifies the item in front of the person, and
 * nothing else verifies anything. A number that falls, repeats, or never arrives leaves the item
 * unclaimed, which is the honest failure: the family is asked in the Orders tab instead of told.
 *
 * Pure and React-free: `e2e/per-item-count.mjs` and `test/basket.test.ts` run it as-is.
 */
export interface PerItemTally {
  /** The store's count when this item's page settled; null until the first reading arrives. */
  readonly baseline: number | null;
  /** Indices, into the per-item list, the store's own count confirmed. */
  readonly verified: ReadonlySet<number>;
}

export const emptyTally: PerItemTally = { baseline: null, verified: new Set() };

/** A reading of the store's basket count while `item` is the one on screen. */
export function readCount(tally: PerItemTally, item: number, n: number): PerItemTally {
  if (!Number.isFinite(n) || n < 0) return tally;                       // "basket:?" — the store did not say
  if (tally.baseline === null) return { ...tally, baseline: n };        // where this page started
  if (n <= tally.baseline) return tally;                                // no rise, no claim
  return { baseline: n, verified: new Set(tally.verified).add(item) };
}

/** Moving to the next item: its page starts a fresh baseline, the verdicts so far stand. */
export function nextItem(tally: PerItemTally): PerItemTally {
  return { baseline: null, verified: tally.verified };
}
