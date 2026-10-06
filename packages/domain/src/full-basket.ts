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
/**
 * Is this substitution actually an alternative to what was asked for?
 *
 * A full basket is a promise that the shop is done, so every line in it must be the thing the family
 * wanted or a genuine stand-in. A swap sharing no word with the request is neither: production
 * answered "אבקת כביסה" with "אל אמ קליק קפסולה חפיסה" on 13 September — not another brand of
 * laundry powder, a different product. Counting it prices a basket nobody asked for and calls the
 * shop done.
 *
 * Generous otherwise: one shared meaningful word is enough, because a real alternative keeps the
 * noun and changes the rest ("קוטג' תנובה" → "קוטג' טרה"). Hebrew finals and plurals are folded so
 * ביצים still matches ביצה.
 */
const altFinals = (w: string) => w.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
const altStem = (w: string) => { const x = altFinals(w); return x.length > 4 ? x.replace(/(יות|ות|ימ|ינ|יה|ה|ת)$/u, '') : x; };
const altWords = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).map(altStem);
export function isRealAlternative(requested: string, offered: string): boolean {
  const want = altWords(requested);
  if (want.length === 0) return true;
  const got = altWords(offered);
  return want.some((w) => got.some((g) => g === w || g.startsWith(w) || w.startsWith(g)));
}

/**
 * The lines a store filled with something that is not an alternative at all. One source of truth:
 * the compare must not offer such a line under that store anywhere, and must name it as a gap.
 */
export function wrongProductLineIds(quote: StorefrontQuote, lineQuery: ReadonlyMap<string, string>): ReadonlySet<string> {
  // EVERY line is judged against what was asked, not only the ones somebody flagged as a swap. The
  // provider can answer "אבקת כביסה" with "אל אמ קליק קפסולה חפיסה" and mark it as no substitution at
  // all (production, 13 September, wolt-victory-tel-aviv-ahad-haam) - so the card would show a
  // capsule pack as though it were exactly the laundry powder the family asked for. A flag we do not
  // control cannot be what decides whether a family gets the right thing.
  return new Set(
    quote.lines
      .filter((l) => !isRealAlternative(lineQuery.get(l.lineId) ?? '', l.productName))
      .map((l) => l.lineId),
  );
}

/**
 * A quote with the lines nobody really filled taken out, and its money put right.
 *
 * This must happen before anything is ranked. Doing it afterwards left the optimizer building legs
 * around products the cards then refused to show, and a winning cart listed lines the phone could not
 * fill (9 of 17, production, 14 September). One removal, upstream of every reader.
 */
export function stripWrongProducts(quote: StorefrontQuote, lineQuery: ReadonlyMap<string, string>): StorefrontQuote {
  const wrong = wrongProductLineIds(quote, lineQuery);
  if (wrong.size === 0) return quote;
  const lines = quote.lines.filter((l) => !wrong.has(l.lineId));
  const removed = quote.lines.filter((l) => wrong.has(l.lineId)).reduce((n, l) => n + l.lineTotal, 0);
  const itemsSubtotal = (quote.itemsSubtotal - removed) as Agorot;
  return {
    ...quote,
    lines,
    itemsSubtotal,
    deliveredTotal: (itemsSubtotal + quote.deliveryFee) as Agorot,
    pricedLines: lines.length,
    ...(quote.minimumOrder !== undefined ? { meetsMinimum: itemsSubtotal >= quote.minimumOrder } : {}),
  };
}

export function storefrontFacts(
  quote: StorefrontQuote,
  requestedLineIds: readonly string[],
  pinnedLineIds: ReadonlySet<string>,
  elsewhereByLine: ReadonlyMap<string, ExactElsewhere>,
  /** What each line asked for in the family's own words, so a swap can be judged against it. */
  lineQuery: ReadonlyMap<string, string> = new Map(),
): StorefrontFacts {
  // A line "filled" with a product that is not an alternative is not filled. The store simply cannot
  // complete it, which the card says plainly instead of pricing the wrong thing into a full basket.
  const wrongProduct = wrongProductLineIds(quote, lineQuery);
  const priced = new Set(quote.lines.filter((l) => !wrongProduct.has(l.lineId)).map((l) => l.lineId));
  const fullBasket: FullBasketFacts = {
    total: quote.deliveredTotal,
    items: quote.itemsSubtotal,
    unfillableLineIds: requestedLineIds.filter((id) => !priced.has(id)),
  };
  const swappedPinned = quote.lines.filter((l) => l.substituted && pinnedLineIds.has(l.lineId) && !wrongProduct.has(l.lineId));
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
