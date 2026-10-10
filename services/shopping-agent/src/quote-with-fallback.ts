/**
 * Quote a basket whose lines carry confirmed barcodes, without letting a
 * storefront that lacks one exact SKU drop out of the comparison.
 *
 * The quote provider takes exactly one identifier per line. A confirmed GTIN
 * is the right identifier — it is what the family actually wants — but no
 * chain stocks every barcode, and a pinned line the storefront cannot supply
 * costs it that line, which at four or five lines pushes the whole storefront
 * under the coverage floor. The first memory-backed run produced zero options
 * for exactly this reason.
 *
 * So: two passes. Pass one prices what was asked for. Pass two re-asks, by the
 * family's own words, only for lines a storefront could not price — and only
 * where the household's substitution policy allows it. A line that came back
 * this way is marked substituted with a reason, so the family sees that this
 * storefront would give them something else, and the optimizer counts it
 * against that option.
 */

import {
  addAgorot,
  memoryKey,
  type Agorot,
  type HouseholdMemory,
  type ListLine,
  type QuotedLine,
  type StorefrontQuote,
} from '@fca/domain';
import type { QuoteProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';

export const CONFIRMED_UNAVAILABLE = 'confirmed_product_unavailable';

export async function quoteWithFallback(
  provider: QuoteProvider,
  req: QuoteRequest,
  memory: HouseholdMemory,
): Promise<QuoteResponse> {
  const first = await provider.quoteBasket(req);

  // Which pinned lines could a storefront not price, and may we substitute?
  const pinned = req.lines.filter((l) => l.gtin !== undefined);
  if (pinned.length === 0) return first;

  const substitutable = new Set(
    pinned
      .filter((l) => (memory.products[memoryKey(l.query)]?.substitution ?? 'equivalent') !== 'never')
      .map((l) => l.id),
  );

  const missingAnywhere = new Set<string>();
  for (const q of first.quotes) {
    const priced = new Set(q.lines.map((l) => l.lineId));
    for (const l of pinned) if (!priced.has(l.id) && substitutable.has(l.id)) missingAnywhere.add(l.id);
  }
  if (missingAnywhere.size === 0) return first;

  // Pass two: the same lines, by query instead of barcode.
  const fallbackLines: ListLine[] = req.lines
    .filter((l) => missingAnywhere.has(l.id))
    .map(({ gtin: _gtin, ...rest }) => rest);
  const second = await provider.quoteBasket({ ...req, lines: fallbackLines });
  const byStorefront = new Map(second.quotes.map((q) => [q.storefrontId, q]));

  const quotes = first.quotes.map<StorefrontQuote>((q) => {
    const priced = new Set(q.lines.map((l) => l.lineId));
    const fb = byStorefront.get(q.storefrontId);
    if (fb === undefined) return q;

    const added: QuotedLine[] = fb.lines
      .filter((l) => !priced.has(l.lineId) && missingAnywhere.has(l.lineId))
      .map((l) => ({
        ...l,
        substituted: true,
        substitutionReason: CONFIRMED_UNAVAILABLE,
      }));
    if (added.length === 0) return q;

    const lines = [...q.lines, ...added];
    const itemsSubtotal = addAgorot(...lines.map((l) => l.lineTotal));
    return {
      ...q,
      lines,
      itemsSubtotal,
      // The delivery fee from pass one stands: it was quoted against the
      // larger basket, and fee bands only ever get cheaper as baskets grow.
      deliveredTotal: addAgorot(itemsSubtotal, q.deliveryFee) as Agorot,
      pricedLines: lines.length,
    };
  });

  return {
    ...first,
    quotes,
    assumptions: [...first.assumptions, ...second.assumptions],
    latencyMs: first.latencyMs + second.latencyMs,
    raw: { first: first.raw, second: second.raw },
  };
}
