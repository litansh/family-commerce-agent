/**
 * What the compare screen is allowed to say about a store (docs/design/compare-accuracy.md).
 *
 * Every number on "איך לקנות" must be one the family could recompute from the same response, and no
 * number may stand beside another it is not comparable with (promise 4). The decisions that settle
 * that — is this store open, what does this option lack, which swap belongs to which leg, what is
 * this row's total really — used to live as closures inside the screen, where nothing could check
 * them; one of them decided a chip's tone by running a regex over rendered Hebrew, and so a Wolt
 * venue shut until tomorrow morning read as "משלוח בחלון".
 *
 * They live here now, and they return kinds, ids and minor units — never words. The screen does the
 * Hebrew; `e2e/compare-accuracy.mjs` runs these same functions over a real compare. Kept free of
 * React, of `./api` and of `./i18n` on purpose, exactly like `./quote.ts`.
 */
import type { QuoteLike } from './quote';

export type EtaLike =
  | { kind: 'live'; minutes?: number; range?: string; name?: string }
  | { kind: 'closed'; nextOpen?: string; text?: string }
  | { kind: 'slots'; earliest?: string; until?: string; windowHours?: number };

export type LegLike = { storefrontId: string; brand: string; itemsSubtotal: number; deliveryFee: number; lineIds: string[] };
export type OptionLike = {
  kind: string; label: string; legs: LegLike[]; cashCost: number; timeCost: number;
  unpricedLineIds: string[]; missingEstimate?: number;
  explanation: { reason: string; savingVsBaseline: number; baselineLabel: string };
};
export type RejectedLike = { storefrontId: string; brand: string; reason: string; code: 'coverage' | 'minimum'; itemsSubtotal: number; pricedLines: number; requestedLines: number; minimumOrder?: number; amountToMinimum?: number };
export type CompareLike = QuoteLike & {
  lines: { id: string; query: string }[];
  options: OptionLike[];
  rejected: RejectedLike[];
  etas?: Record<string, EtaLike>;
  couponSavings?: Record<string, number>;
  branchStock?: Record<string, { branch: number; lineIds: string[] }>;
};

/** A day in minutes: what a chain's delivery window is worth when ranking "how soon". */
const A_DAY = 24 * 60;

/**
 * How soon this storefront delivers, as a number of minutes, for ordering only. A Wolt venue open now
 * says its own minutes; a chain delivers in a window, counted as a day; a venue that is **shut** ranks
 * after every open store, because "הכי מהר" may never name a shop the family cannot order from today.
 */
export function etaRank(eta: EtaLike | undefined): number {
  if (!eta) return A_DAY;
  if (eta.kind === 'live') return eta.minutes ?? A_DAY;
  if (eta.kind === 'closed') return 2 * A_DAY;
  return A_DAY;
}

/** The colour a "when" carries: a live ETA is good news, a closed store is a warning, a window is neither. */
export function etaTone(eta: EtaLike | undefined): 'good' | 'neutral' | 'warn' {
  if (!eta) return 'neutral';
  if (eta.kind === 'live') return 'good';
  if (eta.kind === 'closed') return 'warn';
  return 'neutral';
}

/** `2026-09-14T07:00` → `07:00`. The venue's own sentence is preferred to this; this is the fallback. */
export function opensAt(eta: EtaLike | undefined): string | null {
  if (!eta || eta.kind !== 'closed' || !eta.nextOpen) return null;
  return /T(\d{2}:\d{2})/.exec(eta.nextOpen)?.[1] ?? null;
}

export type Swap = { lineId: string; storefrontId: string; productName: string; reason?: string };

/**
 * What an option lacks and what it swapped — for the whole option, not for its first leg.
 *
 * The missing lines are the optimizer's own `unpricedLineIds`: a split covers a line at whichever leg
 * carries it, so asking one storefront's line map "do you have all eight?" calls the other leg's
 * lines missing. A swap is named only on the leg that actually buys that line, for the same reason:
 * a store may have priced a substitute for a line this option buys elsewhere, and saying so would be
 * a swap the family's basket never makes.
 */
export function exceptionsOf(quote: CompareLike, option: OptionLike): { missingLineIds: string[]; swaps: Swap[] } {
  const swaps: Swap[] = [];
  for (const leg of option.legs) {
    const sl = quote.storefrontLines?.[leg.storefrontId] ?? {};
    for (const lineId of leg.lineIds) {
      const x = sl[lineId];
      if (x?.substituted) swaps.push({ lineId, storefrontId: leg.storefrontId, productName: x.productName, ...(x.reason ? { reason: x.reason } : {}) });
    }
  }
  return { missingLineIds: [...option.unpricedLineIds], swaps };
}

/** The same question for a store the compare rejected: it has no legs, so its own line map is the answer. */
export function exceptionsOfStore(quote: CompareLike, storefrontId: string): { missingLineIds: string[]; swaps: Swap[] } {
  const sl = quote.storefrontLines?.[storefrontId] ?? {};
  const missingLineIds = quote.lines.filter((l) => !sl[l.id]).map((l) => l.id);
  const swaps: Swap[] = quote.lines.filter((l) => sl[l.id]?.substituted).map((l) => ({ lineId: l.id, storefrontId, productName: sl[l.id]!.productName, ...(sl[l.id]!.reason ? { reason: sl[l.id]!.reason! } : {}) }));
  return { missingLineIds, swaps };
}

/**
 * What this option really costs the family: its cash, plus what the lines it cannot supply will cost
 * somewhere else. A seven-of-eight basket at ₪173.10 is not ₪173.10 — it is ₪187.00 and one more
 * errand, and only that number may be set beside a complete basket's (promise 4).
 */
export function completedTotal(option: OptionLike): number {
  return option.cashCost + (option.unpricedLineIds.length ? option.missingEstimate ?? 0 : 0);
}
export const isComplete = (option: OptionLike): boolean => option.unpricedLineIds.length === 0;

/**
 * How much the answer saves, and against what. Promise 2: "for any list there is a cheapest way and a
 * fastest way, and the difference is stated in money".
 *
 * The optimizer's `savingVsBaseline` is silent in the ordinary case, because the baseline it chose is
 * the winner itself — so the screen used to show the family a reason with no figure in it. The
 * comparison that answers the question they actually asked is against the next way they could buy:
 * exact when that alternative is itself complete, and approximate (`approx`) when its total had to be
 * completed with an estimate. Null only when there is genuinely nothing else to buy this list from.
 */
export function savingOf(quote: CompareLike, answer: OptionLike): { minor: number; brand: string; approx: boolean } | null {
  const others = quote.options.filter((o) => o !== answer && o.kind !== 'drive');
  if (!others.length) return null;
  const brandOf = (o: OptionLike) => o.legs.map((l) => l.brand).join(' + ');
  // A complete alternative is the honest yardstick: two full baskets, no estimate on either side.
  const complete = others.filter(isComplete).sort((a, b) => a.cashCost - b.cashCost)[0];
  if (complete) return { minor: complete.cashCost - answer.cashCost, brand: brandOf(complete), approx: false };
  const next = [...others].sort((a, b) => completedTotal(a) - completedTotal(b))[0]!;
  return { minor: completedTotal(next) - answer.cashCost, brand: brandOf(next), approx: true };
}

/**
 * One store on the compare, as data. The same shape for an option and for a store the compare
 * rejected, because the family reads them as one column — which is exactly why `price` may not mean
 * two different things down that column. It does not: `deliveredTotal` says whether this number
 * includes the delivery, and a row that is short of the whole list carries its `completed` total.
 */
export type CompareRow = {
  key: string;
  storefrontId: string;
  brands: { storefrontId: string; brand: string; lineIds: string[]; itemsSubtotal: number; deliveryFee: number }[];
  price: number;
  /** True when `price` is items + delivery, i.e. comparable with the answer's. */
  deliveredTotal: boolean;
  /** Set when this row cannot supply the whole list: price + what the rest will cost elsewhere. */
  completed?: number;
  /** Set when this row costs more than the answer, computed on the completed totals of both. */
  moreThanAnswer?: number;
  /** True when `completed`, and so `moreThanAnswer`, rests on an estimate rather than on priced lines. */
  approx: boolean;
  missingLineIds: string[];
  swaps: Swap[];
  /** A store the basket does not reach the minimum of, and by how much. */
  shortOfMinimum?: number;
  /** For a rejected store: how many of the family's lines its number covers. */
  pricedLines?: number;
  option?: OptionLike;
};

/** Every other way to buy this list: the options the answer is not, then the stores that were rejected. */
export function rowsFor(quote: CompareLike, answer: OptionLike | undefined): CompareRow[] {
  const fromOptions: CompareRow[] = quote.options
    .filter((o) => o !== answer && o.kind !== 'drive')
    .map((o, i) => {
      const ex = exceptionsOf(quote, o);
      const done = completedTotal(o);
      const more = answer && done > answer.cashCost ? done - answer.cashCost : undefined;
      return {
        key: `o-${i}-${o.legs.map((l) => l.storefrontId).join('+')}`,
        storefrontId: o.legs[0]!.storefrontId,
        brands: o.legs.map((l) => ({ storefrontId: l.storefrontId, brand: l.brand, lineIds: l.lineIds, itemsSubtotal: l.itemsSubtotal, deliveryFee: l.deliveryFee })),
        price: o.cashCost,
        deliveredTotal: true,
        ...(isComplete(o) ? {} : { completed: done }),
        ...(more !== undefined ? { moreThanAnswer: more } : {}),
        approx: !isComplete(o),
        ...ex,
        option: o,
      };
    });
  // A rejected store's number is items only: the response carries its minimum but no delivery fee, so
  // there is no delivered total to show and none is invented. The row says so instead.
  const fromRejected: CompareRow[] = quote.rejected.map((r) => ({
    key: `r-${r.storefrontId}`,
    storefrontId: r.storefrontId,
    brands: [{ storefrontId: r.storefrontId, brand: r.brand, lineIds: quote.lines.map((l) => l.id), itemsSubtotal: r.itemsSubtotal, deliveryFee: 0 }],
    price: r.itemsSubtotal,
    deliveredTotal: false,
    approx: false,
    ...exceptionsOfStore(quote, r.storefrontId),
    ...(r.code === 'minimum' && r.amountToMinimum !== undefined ? { shortOfMinimum: r.amountToMinimum } : {}),
    pricedLines: r.pricedLines,
  }));
  // Options first — they are ways to buy the whole list — then the rest, cheapest of each kind first.
  // Within the options the order is the completed total, so a partial basket never jumps a full one.
  return [
    ...fromOptions.sort((a, b) => (a.completed ?? a.price) - (b.completed ?? b.price)),
    ...fromRejected.sort((a, b) => a.price - b.price),
  ];
}
