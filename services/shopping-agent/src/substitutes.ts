/**
 * Substitutes: a store that lacks a line must not vanish from the compare.
 */
import { PARTIAL_LEG_MIN_COVERAGE, type Agorot, type ListLine, type QuotedLine } from '@fca/domain';
import type { CatalogProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';

/**
 * Substitutes for the lines a near-complete storefront lacks. For each missing line (across the
 * storefronts that price at least PARTIAL_LEG_MIN_COVERAGE of the list) the catalogue's closest
 * product is chosen; one more quote with those products prices them at every storefront; a
 * storefront that carries a substitute gets the line back, flagged as substituted with the reason.
 */
export async function substituteMissing(qp: { quoteBasket: (r: QuoteRequest) => Promise<QuoteResponse> }, catalog: CatalogProvider, res: QuoteResponse, lines: readonly ListLine[], address: string): Promise<QuoteResponse> {
  const nearly = res.quotes.filter((q) => q.serviceType === 'delivery' && q.requestedLines > 0 && q.pricedLines < q.requestedLines && q.pricedLines / q.requestedLines >= PARTIAL_LEG_MIN_COVERAGE);
  const missing = new Map<string, ListLine>();
  for (const q of nearly) { const have = new Set(q.lines.map((l) => l.lineId)); for (const l of lines) if (!have.has(l.id)) missing.set(l.id, l); }
  if (missing.size === 0 || missing.size > 6) return res;
  // The closest catalogue product for each missing line: same words, a different product.
  const picks = new Map<string, { gtin: string; name: string }>();
  await Promise.all([...missing.values()].map(async (l) => {
    const found = await catalog.searchProducts({ query: l.query, limit: 6, location: address }).catch(() => []);
    const alt = found.find((c) => c.gtin && c.gtin !== l.gtin && c.pricedAtChains > 0);
    if (alt?.gtin) picks.set(l.id, { gtin: alt.gtin, name: alt.name });
  }));
  if (picks.size === 0) return res;
  const again = await qp.quoteBasket({ lines: [...picks].map(([id, p]) => { const l = missing.get(id)!; return { ...l, gtin: p.gtin, query: p.name }; }), address, serviceType: 'delivery' });
  const quotes = res.quotes.map((q) => {
    if (!nearly.includes(q)) return q;
    const have = new Set(q.lines.map((l) => l.lineId));
    const extra = (again.quotes.find((x) => x.storefrontId === q.storefrontId)?.lines ?? []).filter((l) => !have.has(l.lineId) && picks.has(l.lineId) && !l.substituted).map<QuotedLine>((l) => ({ ...l, substituted: true, substitutionReason: `${missing.get(l.lineId)?.query ?? ''} → ${l.productName}`, resolutionSource: 'search' }));
    if (extra.length === 0) return q;
    const add = extra.reduce((n, l) => n + l.lineTotal, 0);
    const itemsSubtotal = (q.itemsSubtotal + add) as Agorot;
    return { ...q, lines: [...q.lines, ...extra], itemsSubtotal, deliveredTotal: (q.deliveredTotal + add) as Agorot, pricedLines: q.pricedLines + extra.length, meetsMinimum: q.minimumOrder === undefined ? q.meetsMinimum : itemsSubtotal >= q.minimumOrder };
  });
  return { ...res, quotes };
}

