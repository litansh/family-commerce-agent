/**
 * A full basket at every store, and what the family's exact one costs
 * (docs/design/a-full-basket-everywhere.md). This is "the engine line" the design names for
 * api-fixer: `storefrontFacts` gives every delivering storefront a full-basket total (this store's
 * own nearest product wherever it lacks the exact one) and, only when it actually matters, an
 * exact-basket total beside it.
 *
 * Only a line the family pinned - a confirmed barcode - can ever produce that second price. A
 * store's own resolution of a free-text line is not a swap to charge extra for: nobody asked for a
 * specific product, so there is no "exact" version of it to compare against (docs/design: "a line
 * the family never pinned has no exact version, and nothing to charge extra for").
 */
import { addAgorot, agorot, subAgorot, type Agorot } from './money.ts';
import type { StorefrontQuote } from './types.ts';

/** Where the family's own pinned product, unsubstituted, is actually sold - and what it costs there. */
export interface ExactElsewhere {
  readonly lineId: string;
  readonly storefrontId: string;
  readonly brand: string;
  readonly lineTotal: Agorot;
}

export interface FullBasketFacts {
  readonly total: Agorot;
  readonly items: Agorot;
  /** Lines nobody nearby has, not even a substitute - the only honest gap (rule 2). */
  readonly unfillableLineIds: readonly string[];
}

export interface ExactBasketFacts {
  readonly total: Agorot;
  readonly elsewhere: readonly ExactElsewhere[];
}

export interface StorefrontFacts {
  readonly brand: string;
  /** Omitted when this storefront's own delivery terms are not verified - never a delivered total that was guessed (state 10). */
  readonly deliveryFee?: Agorot;
  readonly minimumOrder?: Agorot;
  readonly fullBasket: FullBasketFacts;
  /** Undefined when nothing pinned was swapped here (state 1): one number, no second price. */
  readonly exactBasket?: ExactBasketFacts;
}

/**
 * The cheapest UNsubstituted price of each line, and where - computed once across every quoted
 * storefront and shared by every store's exact-basket total, so a pinned swap can say where the
 * exact product really is (and at what price) rather than inventing one.
 */
export function cheapestExactElsewhere(quotes: readonly StorefrontQuote[]): ReadonlyMap<string, ExactElsewhere> {
  const best = new Map<string, ExactElsewhere>();
  for (const q of quotes) {
    for (const l of q.lines) {
      if (l.substituted) continue;
      const have = best.get(l.lineId);
      if (have === undefined || l.lineTotal < have.lineTotal) best.set(l.lineId, { lineId: l.lineId, storefrontId: q.storefrontId, brand: q.brand, lineTotal: l.lineTotal });
    }
  }
  return best;
}

/**
 * One storefront's full and exact basket facts. Coverage is a fact here, never a gate: every
 * delivering storefront gets a full-basket total, whatever it lacks.
 */
export function storefrontFacts(
  quote: StorefrontQuote,
  requestedLineIds: readonly string[],
  pinnedLineIds: ReadonlySet<string>,
  elsewhereByLine: ReadonlyMap<string, ExactElsewhere>,
): StorefrontFacts {
  const priced = new Set(quote.lines.map((l) => l.lineId));
  const fullBasket: FullBasketFacts = {
    total: quote.deliveredTotal,
    items: quote.itemsSubtotal,
    unfillableLineIds: requestedLineIds.filter((id) => !priced.has(id)),
  };
  const swappedPinned = quote.lines.filter((l) => l.substituted && pinnedLineIds.has(l.lineId));
  const elsewhere = swappedPinned
    .map((l) => elsewhereByLine.get(l.lineId))
    .filter((e): e is ExactElsewhere => e !== undefined);
  // Nobody nearby has any of what was pinned and swapped here: no invented "exact" number, no
  // second price at all (state 5) - not merely no citation for one line among several.
  const exactBasket: ExactBasketFacts | undefined =
    elsewhere.length === 0
      ? undefined
      : {
          total: addAgorot(
            quote.deliveredTotal,
            ...swappedPinned.map((l) => {
              const e = elsewhereByLine.get(l.lineId);
              return e ? subAgorot(e.lineTotal, l.lineTotal) : agorot(0);
            }),
          ),
          elsewhere,
        };
  return {
    brand: quote.brand,
    ...(quote.deliveryTermsConfidence !== 'unknown' ? { deliveryFee: quote.deliveryFee } : {}),
    ...(quote.minimumOrder !== undefined ? { minimumOrder: quote.minimumOrder } : {}),
    fullBasket,
    ...(exactBasket ? { exactBasket } : {}),
  };
}
