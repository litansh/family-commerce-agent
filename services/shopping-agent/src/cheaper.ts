/**
 * "עשה את זה זול יותר" (docs/design/a-full-basket-everywhere.md, rule 4): one action, one store,
 * that swaps every line the family chose itself for the cheapest product of the SAME kind and
 * size at that store - never a smaller pack or a different shelf mistaken for a bargain.
 */
import { type Agorot, type ListLine, type ProductCandidate, type QuotedLine, type StorefrontQuote, variantKey } from '@fca/domain';
import type { CatalogProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';

/** Two candidates a family would call "the same product, different shelf price": same kind, same size. */
function sameKindAndSize(a: ProductCandidate, b: ProductCandidate): boolean {
  const ka = variantKey(a);
  const kb = variantKey(b);
  return ka.base === kb.base && ka.attrs === kb.attrs && ka.size?.qty === kb.size?.qty && ka.size?.unit === kb.size?.unit;
}

/**
 * The cheapest candidate of the same kind and size, strictly cheaper than what the family
 * already chose. `current` must be the catalogue's own entry for the chosen product - a stray
 * price only the catalogue believes is never enough to call it "cheaper" for real (the re-quote
 * in `cheapestBasketFor` confirms it at the actual store before any swap is offered).
 */
export function pickCheaper(current: ProductCandidate, candidates: readonly ProductCandidate[]): ProductCandidate | undefined {
  if (current.fromPrice === undefined) return undefined;
  const cheaper = candidates.filter(
    (c) => c.gtin && c.gtin !== current.gtin && c.pricedAtChains > 0 && c.fromPrice !== undefined && c.fromPrice < current.fromPrice! && sameKindAndSize(current, c),
  );
  return cheaper.sort((a, b) => a.fromPrice! - b.fromPrice!)[0];
}

export interface CheaperSwap {
  readonly lineId: string;
  readonly fromName: string;
  readonly toName: string;
  readonly toGtin: string;
  readonly fromPrice: Agorot;
  readonly toPrice: Agorot;
}

export interface CheaperResult {
  readonly storefrontId: string;
  /** The store's current total for the family's own chosen products. */
  readonly total: Agorot;
  /** The same basket, once every real saving is taken. */
  readonly cheaperTotal: Agorot;
  readonly swaps: readonly CheaperSwap[];
}

/**
 * One store, made cheaper: for every line the family chose itself (never a line this store had
 * already substituted - that swap is already named), search the catalogue for a same-kind,
 * same-size product priced lower, then confirm the real saving with one re-quote at this store -
 * the same "search once, requote once" shape as `substituteMissing`, so the cost is one extra
 * quote for the whole store, not one per line.
 */
export async function cheapestBasketFor(
  qp: { quoteBasket: (r: QuoteRequest) => Promise<QuoteResponse> },
  catalog: CatalogProvider,
  quote: StorefrontQuote,
  lines: readonly ListLine[],
  address: string,
): Promise<CheaperResult> {
  const own = quote.lines.filter((l) => !l.substituted);
  const total = own.reduce((n, l) => n + l.lineTotal, 0) as Agorot;
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  const picks = new Map<string, { gtin: string; name: string }>();
  await Promise.all(
    own.map(async (l) => {
      const src = lineOf.get(l.lineId);
      if (!src) return;
      const found = await catalog.searchProducts({ query: src.query, limit: 8, location: address }).catch(() => []);
      const current = l.gtin ? found.find((c) => c.gtin === l.gtin) : undefined;
      if (!current) return;
      const cheaper = pickCheaper(current, found);
      if (cheaper?.gtin) picks.set(l.lineId, { gtin: cheaper.gtin, name: cheaper.name });
    }),
  );
  if (picks.size === 0) return { storefrontId: quote.storefrontId, total, cheaperTotal: total, swaps: [] };
  const again = await qp.quoteBasket({
    lines: [...picks].map(([id, p]) => { const l = lineOf.get(id)!; return { ...l, gtin: p.gtin, query: p.name }; }),
    address,
    serviceType: quote.serviceType,
  });
  const repriced = new Map<string, QuotedLine>((again.quotes.find((q) => q.storefrontId === quote.storefrontId)?.lines ?? []).filter((l) => picks.has(l.lineId)).map((l) => [l.lineId, l]));
  const swaps: CheaperSwap[] = [];
  let cheaperTotal = total;
  for (const original of own) {
    const priced = repriced.get(original.lineId);
    // The catalogue's indicative price is only ever a candidate to check - only a real, lower
    // quote at this exact store counts as a saving (the same guard `substituteMissing` applies).
    if (!priced || priced.lineTotal >= original.lineTotal) continue;
    swaps.push({ lineId: original.lineId, fromName: original.productName, toName: priced.productName, toGtin: picks.get(original.lineId)!.gtin, fromPrice: original.lineTotal, toPrice: priced.lineTotal });
    cheaperTotal = (cheaperTotal - original.lineTotal + priced.lineTotal) as Agorot;
  }
  return { storefrontId: quote.storefrontId, total, cheaperTotal, swaps };
}
