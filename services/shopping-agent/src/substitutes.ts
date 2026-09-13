/**
 * Substitutes: a store that lacks a line must not vanish from the compare
 * (docs/design/a-full-basket-everywhere.md — coverage is a fact, never a gate).
 */
import { type Agorot, type ListLine, type QuotedLine, isRealAlternative } from '@fca/domain';
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

/** The asked-for phrase as a card says it back: the first meaningful word, which is how people name a thing. */
const stemHead = (q: string): string => words(q)[0] ?? q;

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
  /** Up to this many candidates per missing line: enough that different assortments are covered, few enough to stay polite. */
  const ALTERNATIVES_PER_LINE = 4;
  const picks = new Map<string, { gtin: string; name: string }[]>();
  // Four at a time: twelve searches at once is what a provider answers with `internal_error`.
  const wanted = [...missing.values()].slice(0, maxSearches);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, wanted.length) }, async () => {
    for (let i = next++; i < wanted.length; i = next++) await (async (l) => {
    const found = await catalog.searchProducts({ query: l.query, limit: 12, location: address }).catch(() => []);
    // Several candidates, not one. Stores carry different things: a single global pick leaves every
    // store that happens not to stock it with an empty line, and the card then calls itself partial
    // although the store plainly has eggs. Each store fills the line with whichever it carries.
    const rest = found.filter((c) => c.gtin !== l.gtin);
    const best = pickSubstitute(l.query, rest);
    const alts = [best, ...rest.filter((c) => c !== best && isRealAlternative(l.query, c.name))]
      .filter((c): c is NonNullable<typeof c> => !!c?.gtin)
      .slice(0, ALTERNATIVES_PER_LINE);
    if (alts.length) picks.set(l.id, alts.map((a) => ({ gtin: a.gtin!, name: a.name })));
    })(wanted[i]!);
  }));
  if (picks.size === 0) return res;
  // One extra quote carrying every candidate, each under its own line id, so a store can answer for
  // whichever of them it actually has.
  const candidateLines = [...picks].flatMap(([id, list]) => list.map((p, n) => { const l = missing.get(id)!; return { ...l, id: `${id}~${n}`, gtin: p.gtin, query: p.name }; }));
  const again = await qp.quoteBasket({ lines: candidateLines, address, serviceType: 'delivery' });
  const quotes = res.quotes.map((q) => {
    if (!missingSome.includes(q)) return q;
    const have = new Set(q.lines.map((l) => l.lineId));
    // The cheapest candidate this store actually priced, one per originally-missing line.
    const answered = (again.quotes.find((x) => x.storefrontId === q.storefrontId)?.lines ?? []).filter((l) => l.lineId.includes('~'));
    const bestPerLine = new Map<string, (typeof answered)[number]>();
    for (const l of answered) {
      const original = l.lineId.slice(0, l.lineId.indexOf('~'));
      if (have.has(original)) continue;
      const sofar = bestPerLine.get(original);
      if (!sofar || l.lineTotal < sofar.lineTotal) bestPerLine.set(original, l);
    }
    // Back under the line the family asked for, and named the way the card reads it:
    // "what you asked → what this store has".
    const extra = [...bestPerLine].map(([original, l]) => ({
      ...l,
      lineId: original,
      substituted: true,
      substitutionReason: `${stemHead(missing.get(original)?.query ?? '')} → ${l.productName}`,
    }));
    if (extra.length === 0) return q;
    const add = extra.reduce((n, l) => n + l.lineTotal, 0);
    const itemsSubtotal = (q.itemsSubtotal + add) as Agorot;
    return { ...q, lines: [...q.lines, ...extra], itemsSubtotal, deliveredTotal: (q.deliveredTotal + add) as Agorot, pricedLines: q.pricedLines + extra.length, meetsMinimum: q.minimumOrder === undefined ? q.meetsMinimum : itemsSubtotal >= q.minimumOrder };
  });
  return { ...res, quotes };
}

