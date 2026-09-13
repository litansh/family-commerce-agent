/**
 * Substitutes: a store that lacks a line must not vanish from the compare
 * (docs/design/a-full-basket-everywhere.md — coverage is a fact, never a gate).
 */
import { type Agorot, type ListLine, type QuotedLine } from '@fca/domain';
import type { CatalogProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';

/**
 * Substitutes for the lines a delivering storefront lacks, however much of the list it lacks -
 * every store gets its own shot at a full basket, not just the near-complete ones. For each
 * missing line the catalogue's closest product is chosen; one more quote with those products
 * prices them at every storefront; a storefront that carries a substitute gets the line back,
 * flagged as substituted with the reason.
 */
/**
 * The closest product of the SAME KIND. The catalogue's first hit for "עגבניות" is a can of
 * chopped tomatoes and for "מלפפונים" a jar of pickles: right words, wrong shelf. A substitute
 * must carry every word of the line and add no processing the line did not ask for; among
 * those, the one priced at most chains, then the shortest name.
 */
const PROCESSED = /מעושן|מעושנת|בחומץ|במלח|כבוש|כבושים|חמוצים|קצוצ|חתוכ|מקולפ|רסק|משומר|שימורים|קפוא|קפואה|קפואים|מיובש|מיובשים|אבקת|רוטב|מרק|ממרח|טעם|בטעם|מרוכז|תרכיז/;
const words = (s: string) => s.toLowerCase().replace(/["'׳״%().,\-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/^(ק"ג|קג|גרם|גר|ליטר|ל|מל|יח|יחידות|x)$/.test(w));
/**
 * Hebrew plural and gender endings fall away, so עגבניות ~ עגבניה, מלפפונים ~ מלפפון, ביצים ~ ביצה.
 * Final letters are normalised first, so the endings are written with the regular letters
 * (ימ, ינ): with the final ם/ן the plural was never stripped and ביצים stayed apart from ביצה.
 */
const finals = (w: string) => w.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
export const hebStem = (w: string): string => { const x = finals(w); return x.length > 4 ? x.replace(/(יות|ות|ימ|ינ|יה|ה|ת)$/u, '') : x; };
export const sameWord = (a: string, b: string): boolean => { if (a === b) return true; const [x, y] = [hebStem(a), hebStem(b)]; return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(y) || y.startsWith(x)); };
export function pickSubstitute<T extends { gtin?: string; name: string; pricedAtChains: number }>(query: string, candidates: readonly T[]): T | undefined {
  const q = words(query);
  const asksProcessed = PROCESSED.test(query);
  const same = candidates.filter((c) => c.gtin && c.pricedAtChains > 0 && q.every((w) => words(c.name).some((v) => sameWord(v, w))) && (asksProcessed || !PROCESSED.test(c.name)));
  return same.sort((a, b) => b.pricedAtChains - a.pricedAtChains || a.name.length - b.name.length)[0];
}

export async function substituteMissing(qp: { quoteBasket: (r: QuoteRequest) => Promise<QuoteResponse> }, catalog: CatalogProvider, res: QuoteResponse, lines: readonly ListLine[], address: string,
  /** How many distinct missing lines to look up. The sync route has seconds; the background job has minutes. */
  maxSearches = 12,
): Promise<QuoteResponse> {
  const missingSome = res.quotes.filter((q) => q.serviceType === 'delivery' && q.requestedLines > 0 && q.pricedLines < q.requestedLines);
  const missing = new Map<string, ListLine>();
  for (const q of missingSome) { const have = new Set(q.lines.map((l) => l.lineId)); for (const l of lines) if (!have.has(l.id)) missing.set(l.id, l); }
  if (missing.size === 0) return res;
  // One catalogue search per distinct missing line, up to `maxSearches`: a ten-line list with four near-complete
  // stores must not bail out because their gaps differ - that left every alternative unpriced.
  // The closest catalogue product for each missing line: same words, a different product.
  const picks = new Map<string, { gtin: string; name: string }>();
  // Four at a time: twelve searches at once is what a provider answers with `internal_error`.
  const wanted = [...missing.values()].slice(0, maxSearches);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, wanted.length) }, async () => {
    for (let i = next++; i < wanted.length; i = next++) await (async (l) => {
    const found = await catalog.searchProducts({ query: l.query, limit: 8, location: address }).catch(() => []);
    const alt = pickSubstitute(l.query, found.filter((c) => c.gtin !== l.gtin));
    if (alt?.gtin) picks.set(l.id, { gtin: alt.gtin, name: alt.name });
    })(wanted[i]!);
  }));
  if (picks.size === 0) return res;
  const again = await qp.quoteBasket({ lines: [...picks].map(([id, p]) => { const l = missing.get(id)!; return { ...l, gtin: p.gtin, query: p.name }; }), address, serviceType: 'delivery' });
  const quotes = res.quotes.map((q) => {
    if (!missingSome.includes(q)) return q;
    const have = new Set(q.lines.map((l) => l.lineId));
    const extra = (again.quotes.find((x) => x.storefrontId === q.storefrontId)?.lines ?? []).filter((l) => !have.has(l.lineId) && picks.has(l.lineId) && !l.substituted).map<QuotedLine>((l) => ({ ...l, substituted: true, substitutionReason: `${missing.get(l.lineId)?.query ?? ''} → ${l.productName}`, resolutionSource: 'search' }));
    if (extra.length === 0) return q;
    const add = extra.reduce((n, l) => n + l.lineTotal, 0);
    const itemsSubtotal = (q.itemsSubtotal + add) as Agorot;
    return { ...q, lines: [...q.lines, ...extra], itemsSubtotal, deliveredTotal: (q.deliveredTotal + add) as Agorot, pricedLines: q.pricedLines + extra.length, meetsMinimum: q.minimumOrder === undefined ? q.meetsMinimum : itemsSubtotal >= q.minimumOrder };
  });
  return { ...res, quotes };
}

