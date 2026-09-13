/**
 * A full basket at every store, and what the family's exact one costs
 * (docs/design/a-full-basket-everywhere.md).
 *
 * Nobody orders a partial basket. So the question this module answers is not "which store has most of
 * my list" but "where do I buy all of it, and what does my exact version cost?" — one card per
 * storefront that delivers, each with a basket it can actually fill, the alternatives it used named
 * one by one, and the difference in shekels when the family wants their own product instead.
 *
 * **This module cannot invent a total, by construction.** `storefrontLines[sid][lineId].price` is the
 * provider's *unit* price; the engine's subtotal is built from `lineTotal`, which carries promotions.
 * On the capture in `e2e/lab/compare.json` the two disagree by ₪8–₪21 at every chain (₪107.40 summed
 * against ₪98.99 at Rami Levy; exact to the agora at the four Wolt venues, which is what points at
 * promotions). A card whose line prices do not add up to its own headline breaks promise 4 in the most
 * direct way there is. So every total here comes from the engine — an option's own cash, a leg's
 * subtotal, a rejected store's `itemsSubtotal`, or the `storefronts` facts when the quote carries them
 * — and where no engine number exists the card gets `undefined` and says the weaker true thing.
 *
 * Pure, React-free, and free of `./api` and `./i18n` on purpose, exactly like `./compare.ts` and
 * `./quote.ts`: `e2e/full-basket.mjs` runs these same functions over a real compare, and
 * `test/fullBasket.test.ts` over the fixture.
 */
import type { CompareLike, LegLike, OptionLike, RejectedLike } from './compare';

/** Minor units — agorot. The app never holds a price as a float. */
export type Agorot = number;

/**
 * What the engine says about one storefront, when the quote carries it. Every field is optional: the
 * cards were built to work before this landed and to get better, not to change shape, once it does
 * (docs/design/a-full-basket-everywhere.md, "What the screen must be able to read").
 */
export interface StorefrontFacts {
  brand?: string;
  deliveryFee?: Agorot;
  minimumOrder?: Agorot;
  fullBasket?: { total?: Agorot; items?: Agorot; unfillableLineIds?: readonly string[] };
  exactBasket?: { total?: Agorot; elsewhere?: readonly { lineId: string; storefrontId: string; brand: string; lineTotal?: Agorot }[] };
}

/** One product this store would put in the basket in place of a cheaper-able line. */
export interface CheaperSwap { lineId: string; gtin?: string; productName: string; lineTotal?: Agorot; wasLineTotal?: Agorot }

export type BasketLike = CompareLike & {
  storefronts?: Record<string, StorefrontFacts>;
  cheaper?: Record<string, readonly CheaperSwap[]>;
};

/**
 * Why a line in this basket is not the product the family asked for.
 *
 * The two kinds are never merged, and never share a colour on screen, because undoing them costs
 * different things: a `missing` swap cannot be undone at this store at all — that line is bought
 * somewhere else — while a `cheaper` swap is one free tap back, the exact product being on the shelf.
 * Telling a family a swap is reversible when it is not is the failure this split exists to prevent.
 */
export type SwapKind = 'missing' | 'cheaper';

export interface BasketSwap {
  lineId: string;
  /** The family's own words for the line. */
  asked: string;
  /** What this store puts behind them. */
  got: string;
  kind: SwapKind;
  /** What this line costs inside this basket. Absent unless the engine said — never a summed unit price. */
  lineTotal?: Agorot;
  /** A `cheaper` swap only: what choosing it saved. */
  saved?: Agorot;
  /** True when no store on this compare has the product the family pinned (design state 5). */
  nowhere?: boolean;
  /** Stores that do have the pinned product, when any do (design state 4). */
  elsewhere?: { storefrontId: string; brand: string }[];
}

export type BasketMode = 'full' | 'exact' | 'cheap';

/** One priced basket. `delivered` is the only thing that makes two stores' numbers comparable. */
export interface BasketPrice {
  mode: BasketMode;
  /** Items + delivery when `delivered`, items alone when not. Absent when the engine gave no total. */
  total?: Agorot;
  items?: Agorot;
  deliveryFee?: Agorot;
  /** True when `total` is items + delivery, i.e. may sit in the same column as another store's. */
  delivered: boolean;
  /** True when any part of `total` rests on an estimate rather than on priced lines. */
  approx: boolean;
}

/**
 * The rows of the design's state table this card is in. A card is usually in several at once — a
 * complete basket can be under a minimum and have a swap — so this is a list, and
 * `e2e/full-basket.mjs` asserts every row in the table is reachable from a real compare.
 */
export type CardState =
  | 'yours'            // 1  every line, nothing pinned was swapped: one number
  | 'full-with-swaps'  // 2  every line, a pinned line swapped
  | 'exact-cheaper'    // 3  the exact basket is the cheaper of the two
  | 'exact-elsewhere'  // 4  the exact basket needs another store
  | 'exact-nowhere'    // 5  nobody nearby has the pinned product
  | 'cannot-fill'      // 6  a line this store cannot fill, even with an alternative
  | 'under-minimum'    // 7  basket complete, under the store's minimum
  | 'cheapened'        // 8  "עשה את זה זול יותר" has run
  | 'cheaper-none'     // 9  nothing cheaper here
  | 'fee-unknown'      // 10 no delivery fee yet: the number is items-only
  | 'closed'           // 11 the store is shut
  | 'approx';          // 12 a number resting on an estimate

export interface StoreCardFacts {
  storefrontId: string;
  brand: string;
  /** Lines this store can put in the basket, exactly or with a stand-in. */
  filled: number;
  /** Lines the family asked for. */
  asked: number;
  /** The only honest gap: lines this store cannot fill even with an alternative. */
  unfillableLineIds: string[];
  /** True when this store fills every line — the basket the family would actually order. */
  complete: boolean;
  full: BasketPrice;
  /** Present only when this store swapped a line the family pinned AND the exact one is buyable. */
  exact?: BasketPrice;
  /** Present only when the engine found something cheaper of the same kind and size here. */
  cheap?: BasketPrice;
  swaps: BasketSwap[];
  minimumOrder?: Agorot;
  /** How far this basket is from the store's minimum. Set only when it is short. */
  shortOfMinimum?: Agorot;
  closed: boolean;
  states: CardState[];
  /** The option this store is, when it is one — so "buy here" can order it as the compare priced it. */
  option?: OptionLike;
}

/** A single-leg option is this storefront's own basket; a leg of a split is not, so it is not used here. */
const soleOption = (quote: BasketLike, sid: string): OptionLike | undefined =>
  quote.options.find((o) => o.kind !== 'drive' && o.legs.length === 1 && o.legs[0]!.storefrontId === sid);

const legFor = (quote: BasketLike, sid: string): LegLike | undefined =>
  quote.options.flatMap((o) => o.legs).find((l) => l.storefrontId === sid);

const rejectedFor = (quote: BasketLike, sid: string): RejectedLike | undefined =>
  quote.rejected.find((r) => r.storefrontId === sid);

/**
 * Which stores on this compare have the product the family pinned for a line — that is, priced it
 * without substituting. Empty means nobody nearby has it, which is the only gap the design calls
 * honest; on today's capture that is true of שמן זית at all twelve storefronts.
 */
export function whereExact(quote: BasketLike, lineId: string): { storefrontId: string; brand: string }[] {
  return Object.entries(quote.storefrontLines ?? {})
    .filter(([, m]) => m[lineId] && !m[lineId]!.substituted)
    .map(([sid]) => ({ storefrontId: sid, brand: brandOf(quote, sid) }));
}

/** The store's name as the compare already spells it; never an id, never a provider code. */
export function brandOf(quote: BasketLike, sid: string): string {
  return quote.storefronts?.[sid]?.brand ?? legFor(quote, sid)?.brand ?? rejectedFor(quote, sid)?.brand ?? sid;
}

/**
 * What one line costs inside this basket. The engine's `lineTotal` when it said so; otherwise the
 * store's unit price, and only when the line is a single unit, where the two are the same number.
 * Anything else would be a total this module made up.
 */
function lineTotalOf(quote: BasketLike, sid: string, lineId: string): Agorot | undefined {
  const x = quote.storefrontLines?.[sid]?.[lineId] as { price?: number; lineTotal?: number } | undefined;
  if (!x) return undefined;
  if (x.lineTotal !== undefined) return x.lineTotal;
  const qty = (quote.lines.find((l) => l.id === lineId) as { packQty?: number } | undefined)?.packQty;
  return qty === undefined || qty === 1 ? x.price : undefined;
}

/**
 * The items total for this store's whole basket — the engine's own number, found down a short ladder
 * and never computed here: the `storefronts` facts, then a single-leg option's own subtotal, then the
 * rejected row's `itemsSubtotal`. A store the compare shows in none of those gets no number at all.
 */
function itemsOf(quote: BasketLike, sid: string): Agorot | undefined {
  const facts = quote.storefronts?.[sid];
  if (facts?.fullBasket?.items !== undefined) return facts.fullBasket.items;
  const sole = soleOption(quote, sid);
  if (sole) return sole.legs[0]!.itemsSubtotal;
  return rejectedFor(quote, sid)?.itemsSubtotal;
}

/** This store's delivery fee, when anything in the response knows it. */
function feeOf(quote: BasketLike, sid: string): Agorot | undefined {
  const facts = quote.storefronts?.[sid];
  if (facts?.deliveryFee !== undefined) return facts.deliveryFee;
  return legFor(quote, sid)?.deliveryFee;
}

/**
 * One store's card, as facts. The words are the screen's job — this returns kinds, ids and minor
 * units only, so `e2e/full-basket.mjs` can check the rules against a real compare rather than against
 * rendered Hebrew (docs/design/compare-accuracy.md).
 */
export function cardFor(quote: BasketLike, sid: string): StoreCardFacts {
  const facts = quote.storefronts?.[sid];
  const sl = quote.storefrontLines?.[sid] ?? {};
  const asked = quote.lines.length;
  const filledLines = quote.lines.filter((l) => sl[l.id]);
  const unfillableLineIds = [...(facts?.fullBasket?.unfillableLineIds ?? quote.lines.filter((l) => !sl[l.id]).map((l) => l.id))];
  const complete = unfillableLineIds.length === 0;

  // Every alternative this store used, named next to what was asked for. `substituted` is the store
  // saying "you pinned a product I have not got"; a free-text line has no exact version and so never
  // appears here, which is why an ordinary list shows one number per card and not two.
  const cheaperById = new Map((quote.cheaper?.[sid] ?? []).map((c) => [c.lineId, c]));
  const swaps: BasketSwap[] = filledLines.flatMap((l): BasketSwap[] => {
    const x = sl[l.id]!;
    const cheap = cheaperById.get(l.id);
    if (cheap) {
      const saved = cheap.wasLineTotal !== undefined && cheap.lineTotal !== undefined ? cheap.wasLineTotal - cheap.lineTotal : undefined;
      return [{ lineId: l.id, asked: l.query, got: cheap.productName, kind: 'cheaper' as const, ...(cheap.lineTotal !== undefined ? { lineTotal: cheap.lineTotal } : {}), ...(saved !== undefined ? { saved } : {}) }];
    }
    if (!x.substituted) return [];
    const elsewhere = whereExact(quote, l.id);
    const lt = lineTotalOf(quote, sid, l.id);
    return [{
      lineId: l.id, asked: l.query, got: x.productName, kind: 'missing' as const,
      ...(lt !== undefined ? { lineTotal: lt } : {}),
      ...(elsewhere.length ? { elsewhere } : { nowhere: true }),
    }];
  });

  const items = itemsOf(quote, sid);
  const fee = feeOf(quote, sid);
  const sole = soleOption(quote, sid);
  // A single-leg option's `cashCost` is already the delivered total the family would pay, net of any
  // coupon — so it is preferred to items + fee, which would quietly drop the coupon.
  const fullTotal = facts?.fullBasket?.total ?? (sole ? sole.cashCost : items !== undefined && fee !== undefined ? items + fee : items);
  /**
   * Whether this number is items + delivery, and so may sit in the same column as another store's.
   *
   * It is decided by **whether a delivery fee is known**, never by whether a total arrived. The
   * engine returns a `fullBasket.total` for every store it can price, and for a store whose fee it
   * does not have that total is the items subtotal — on the live compare, ויקטורי's `total` and
   * `items` are both ₪133.90 and there is no `deliveryFee`. Reading "a total exists" as "a delivered
   * total exists" put an items-only number in the delivered column, which is the exact thing promise
   * 4 forbids and the reason this module exists.
   */
  const delivered = fee !== undefined || sole !== undefined;
  const full: BasketPrice = {
    mode: 'full', delivered, approx: false,
    ...(fullTotal !== undefined ? { total: fullTotal } : {}),
    ...(items !== undefined ? { items } : {}),
    ...(fee !== undefined ? { deliveryFee: fee } : {}),
  };

  // The exact basket is offered only when it is a thing the family could actually buy: a pinned line
  // was swapped here, and the product they pinned exists somewhere on this compare. When the engine
  // has not priced it, the card says where the exact one is and shows no second headline — a number
  // that had to cross a store boundary is a number with a second delivery inside it.
  const missingSwaps = swaps.filter((s) => s.kind === 'missing');
  const exactBuyable = missingSwaps.some((s) => !s.nowhere);
  const exactTotal = facts?.exactBasket?.total;
  const exact: BasketPrice | undefined = exactTotal !== undefined
    ? { mode: 'exact', total: exactTotal, delivered, approx: (facts?.exactBasket?.elsewhere?.length ?? 0) > 0 }
    : undefined;

  const cheapList = quote.cheaper?.[sid];
  const cheapSaved = swaps.filter((s) => s.kind === 'cheaper').reduce((n, s) => n + (s.saved ?? 0), 0);
  const cheap: BasketPrice | undefined = cheapList && cheapList.length && fullTotal !== undefined
    ? { mode: 'cheap', total: fullTotal - cheapSaved, delivered, approx: false }
    : undefined;

  const rej = rejectedFor(quote, sid);
  const minimumOrder = facts?.minimumOrder ?? rej?.minimumOrder;
  const shortOfMinimum = rej?.code === 'minimum' && rej.amountToMinimum !== undefined ? rej.amountToMinimum
    : minimumOrder !== undefined && items !== undefined && items < minimumOrder ? minimumOrder - items
    : undefined;
  const closed = quote.etas?.[sid]?.kind === 'closed';

  const states: CardState[] = [];
  if (complete && !missingSwaps.length) states.push('yours');
  if (complete && missingSwaps.length) states.push('full-with-swaps');
  if (exact?.total !== undefined && fullTotal !== undefined && exact.total < fullTotal) states.push('exact-cheaper');
  if (exactBuyable) states.push('exact-elsewhere');
  if (missingSwaps.some((s) => s.nowhere)) states.push('exact-nowhere');
  if (!complete) states.push('cannot-fill');
  if (shortOfMinimum !== undefined && shortOfMinimum > 0) states.push('under-minimum');
  if (cheap) states.push('cheapened');
  if (cheapList && cheapList.length === 0) states.push('cheaper-none');
  if (!delivered) states.push('fee-unknown');
  if (closed) states.push('closed');
  if (full.approx || exact?.approx) states.push('approx');

  return {
    storefrontId: sid, brand: brandOf(quote, sid), filled: filledLines.length, asked,
    unfillableLineIds, complete, full, swaps, closed, states,
    ...(exact ? { exact } : {}),
    ...(cheap ? { cheap } : {}),
    ...(minimumOrder !== undefined ? { minimumOrder } : {}),
    ...(shortOfMinimum !== undefined && shortOfMinimum > 0 ? { shortOfMinimum } : {}),
    ...(sole ? { option: sole } : {}),
  };
}

/**
 * Every store that delivers, each with the basket it can fill. Coverage is a fact on a card here, not
 * a gate: the only store without a card is a store that does not deliver to the address.
 *
 * The order is the items subtotal, ascending, with the complete baskets first. Items — not the
 * delivered total — because a store whose delivery fee the response has not said yet would otherwise
 * have to be ranked on a fee this module invented, and every store's items total is comparable with
 * every other's. Complete baskets lead because a basket missing a line is not a way to buy the list.
 */
export function cardsFor(quote: BasketLike): StoreCardFacts[] {
  const sids = Object.keys(quote.storefrontLines ?? {});
  const cards = sids.map((sid) => cardFor(quote, sid));
  const rank = (c: StoreCardFacts) => c.full.items ?? c.full.total ?? Number.MAX_SAFE_INTEGER;
  const complete = cards.filter((c) => c.complete).sort((a, b) => rank(a) - rank(b));
  // A store that cannot fill the basket is ranked by how much of it it does fill, then by price: its
  // number is not a basket, so putting it in the same price order would compare unlike things.
  const partial = cards.filter((c) => !c.complete).sort((a, b) => b.filled - a.filled || rank(a) - rank(b));
  return [...complete, ...partial];
}

/** The basket the card is showing, when the family has asked for one. `null` means "whichever leads". */
export const basketOf = (card: StoreCardFacts, mode: BasketMode): BasketPrice | undefined =>
  mode === 'cheap' ? card.cheap : mode === 'exact' ? card.exact : card.full;

/**
 * The basket a card leads with. One headline per card, and it is cash.
 *
 * `want` is the family's own tap — the exact basket or the cheapened one, each reachable in one.
 * Left to itself the card leads with the full basket, except where the exact basket is genuinely the
 * cheaper of the two: nobody should be made to pay for a stand-in they did not ask for.
 */
export function headlineOf(card: StoreCardFacts, want?: BasketMode | null): BasketPrice {
  if (want) { const b = basketOf(card, want); if (b?.total !== undefined) return b; }
  if (card.exact?.total !== undefined && card.full.total !== undefined && card.exact.total < card.full.total) return card.exact;
  return card.full;
}

/**
 * The other basket the card names beside its headline, with the difference in shekels — the cheapest
 * of the ones this store can actually price. Null when there is only one basket here, which is the
 * ordinary case: a list with nothing pinned has no exact version to cost, and the card stays calm.
 */
export function alternativeTo(card: StoreCardFacts, headline: BasketPrice): { basket: BasketPrice; diff: Agorot } | null {
  const others = [card.full, card.exact, card.cheap].filter((b): b is BasketPrice => !!b && b !== headline && b.total !== undefined);
  if (headline.total === undefined || !others.length) return null;
  const basket = others.sort((a, b) => a.total! - b.total!)[0]!;
  return { basket, diff: basket.total! - headline.total };
}
