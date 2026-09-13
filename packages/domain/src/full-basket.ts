/**
 * A full basket at every store, and what the family's exact one costs
 * (docs/design/a-full-basket-everywhere.md).
 *
 * Every storefront that delivers gets two totals, never one: the FULL basket, priced with this
 * store's own nearest product wherever it lacks the exact line (already what substituteMissing
 * folds into a StorefrontQuote's itemsSubtotal/deliveredTotal); and the family's EXACT basket -
 * what it would cost to insist on the products actually chosen, sourced at the cheapest price any
 * store prices them, unswapped. The two must differ by exactly the sum of the swaps: this module
 * builds the exact total FROM the full one, one swap's delta at a time, so that holds by
 * construction rather than by two independent calculations that could drift apart.
 */
import { addAgorot, agorot, subAgorot, type Agorot } from './money.ts';
import type { QuotedLine, StorefrontQuote } from './types.ts';

export interface SwapLine {
  readonly lineId: string;
  /** What the family asked for, e.g. "קוטג' תנובה". */
  readonly requestedQuery: string;
  /** What this store offers instead, e.g. "קוטג' טרה 5%". */
  readonly productName: string;
  readonly reason?: string;
  /** What this store charges for its own alternative. */
  readonly swapPrice: Agorot;
  /**
   * The cheapest price the exact product the family chose costs anywhere it is sold. Equal to
   * `swapPrice` when no store prices the exact product at all - the honest answer is "we do not
   * know it costs more", never an invented number.
   */
  readonly exactPrice: Agorot;
}

export interface FullBasketResult {
  readonly storefrontId: string;
  /** Every line, this store's own nearest product wherever it lacks the exact one. */
  readonly fullBasketTotal: Agorot;
  /** Only the products the family actually chose - the full total, undoing every swap's saving. */
  readonly exactBasketTotal: Agorot;
  readonly swaps: readonly SwapLine[];
  /** Lines nobody nearby has, not even a substitute - the only honest gap (rule 2). */
  readonly unresolvedLineIds: readonly string[];
}

/**
 * The cheapest price the exact (unsubstituted) product for each line sells for, across every
 * storefront quoted - so a swap's "what it would really cost" is never a guess at one store, and
 * is computed once and shared by every store's full-basket total.
 */
export function cheapestExactPricePerLine(quotes: readonly StorefrontQuote[]): ReadonlyMap<string, Agorot> {
  const cheapest = new Map<string, Agorot>();
  for (const q of quotes) {
    for (const l of q.lines) {
      if (l.substituted) continue;
      const have = cheapest.get(l.lineId);
      if (have === undefined || l.lineTotal < have) cheapest.set(l.lineId, l.lineTotal);
    }
  }
  return cheapest;
}

/** A substitution's reason as a person reads it: "what you asked → what this store has". */
const reasonFor = (l: QuotedLine, query: string): string | undefined =>
  l.substitutionReason && l.substitutionReason.includes('→') ? l.substitutionReason : query ? `${query} → ${l.productName}` : undefined;

/**
 * One storefront's full and exact totals, and the swap list between them. Coverage is a fact
 * here, never a gate: every delivering storefront gets both numbers, whatever it lacks.
 */
export function fullBasketFor(
  quote: StorefrontQuote,
  requestedLineIds: readonly string[],
  lineQuery: ReadonlyMap<string, string>,
  exactPriceByLine: ReadonlyMap<string, Agorot>,
): FullBasketResult {
  const priced = new Set(quote.lines.map((l) => l.lineId));
  const swaps: SwapLine[] = quote.lines
    .filter((l) => l.substituted)
    .map((l) => {
      const exactPrice = exactPriceByLine.get(l.lineId) ?? l.lineTotal;
      const requestedQuery = lineQuery.get(l.lineId) ?? '';
      return {
        lineId: l.lineId,
        requestedQuery,
        productName: l.productName,
        ...(reasonFor(l, requestedQuery) ? { reason: reasonFor(l, requestedQuery)! } : {}),
        swapPrice: l.lineTotal,
        exactPrice,
      };
    });
  const delta = swaps.length ? addAgorot(...swaps.map((s) => subAgorot(s.exactPrice, s.swapPrice))) : agorot(0);
  return {
    storefrontId: quote.storefrontId,
    fullBasketTotal: quote.deliveredTotal,
    exactBasketTotal: addAgorot(quote.deliveredTotal, delta),
    swaps,
    unresolvedLineIds: requestedLineIds.filter((id) => !priced.has(id)),
  };
}
