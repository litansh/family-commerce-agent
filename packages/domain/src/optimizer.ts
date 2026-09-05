/**
 * The basket optimizer.
 *
 * A pure function: quotes in, ranked options out. No I/O, no network, no LLM,
 * no clock. Everything it decides is reproducible from its arguments, which is
 * what makes it testable and what keeps price arithmetic out of a prompt.
 */

import { addAgorot, agorot, scaleAgorot, subAgorot, type Agorot } from './money.ts';
import {
  coverageRatio,
  type HouseholdConstants,
  type OptionLeg,
  type PurchaseOption,
  type QuotedLine,
  type StorefrontQuote,
  type TravelCost,
} from './types.ts';

export interface OptimizeInput {
  readonly quotes: readonly StorefrontQuote[];
  readonly constants: HouseholdConstants;
  readonly requestedLineIds: readonly string[];
  /** Optional physical-branch trips, for the drive-yourself comparison. */
  readonly driveOptions?: readonly DriveCandidate[];
}

export interface DriveCandidate {
  readonly quote: StorefrontQuote;
  readonly travel: TravelCost;
}

/**
 * A price gap this wide across chains for the same line is a resolution error,
 * not a bargain. Learned the expensive way by a prior project, where "בננה"
 * resolved to banana-flavoured protein powder.
 */
export const SUSPICIOUS_PRICE_RATIO = 3;

export interface OptimizeResult {
  readonly options: readonly PurchaseOption[];
  /** Storefronts excluded, and why. Surfaced so a missing chain is explainable. */
  readonly rejected: readonly { storefrontId: string; brand: string; reason: string }[];
  readonly warnings: readonly string[];
}

export function optimize(input: OptimizeInput): OptimizeResult {
  const { quotes, constants, requestedLineIds } = input;
  const rejected: { storefrontId: string; brand: string; reason: string }[] = [];
  const warnings: string[] = [...detectSuspiciousLines(quotes)];

  // --- Gate 1: coverage. A partial basket is not a cheap option, it is an
  // incomplete one, and offering it causes the top-up trip we exist to prevent.
  const eligible = quotes.filter((q) => {
    const cov = coverageRatio(q);
    if (cov < constants.minCoverageRatio) {
      rejected.push({
        storefrontId: q.storefrontId,
        brand: q.brand,
        reason: `prices only ${q.pricedLines}/${q.requestedLines} lines (${pct(cov)}) — below the ${pct(constants.minCoverageRatio)} floor`,
      });
      return false;
    }
    if (!q.meetsMinimum) {
      rejected.push({
        storefrontId: q.storefrontId,
        brand: q.brand,
        reason: 'basket is below the storefront minimum',
      });
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return { options: [], rejected, warnings };
  }

  const delivery = eligible.filter((q) => q.serviceType === 'delivery');
  const pickup = eligible.filter((q) => q.serviceType === 'pickup');

  // --- Baseline: the cheapest complete single delivered basket.
  const singles = [...delivery].sort((a, b) => a.deliveredTotal - b.deliveredTotal);
  const best = singles[0];
  if (best === undefined) {
    return { options: [], rejected, warnings };
  }

  const options: PurchaseOption[] = [];
  const baseline = singleOption(best, requestedLineIds, {
    reason: 'Cheapest complete basket from one retailer',
    savingVsBaseline: agorot(0),
    baselineLabel: best.brand,
    extraStores: 0,
    notes: [],
  });
  options.push(baseline);

  // --- A convenience option, when it is a genuinely different storefront.
  const convenience = singles.find(
    (q) => q.storefrontId !== best.storefrontId && q.deliveryTermsConfidence === 'verified',
  );
  if (convenience !== undefined) {
    options.push(
      singleOption(convenience, requestedLineIds, {
        reason: 'Single retailer with verified delivery terms',
        savingVsBaseline: subAgorot(best.deliveredTotal, convenience.deliveredTotal),
        baselineLabel: best.brand,
        extraStores: 0,
        notes: [],
      }),
    );
  }

  // --- Split. Measured to be worth it at family scale (~₪67 on a ₪1,000 basket)
  // and measured NOT to be worth a third store, so maxStores caps it.
  if (constants.maxStores >= 2) {
    const split = bestSplit(delivery, requestedLineIds, constants, best);
    if (split !== undefined) options.push(split);
  }

  // --- Pickup and drive, kept in the model but demoted: for the household this
  // was measured against, pickup lost to delivery on item prices.
  const bestPickup = [...pickup].sort((a, b) => a.deliveredTotal - b.deliveredTotal)[0];
  if (bestPickup !== undefined) {
    const saving = subAgorot(best.deliveredTotal, bestPickup.deliveredTotal);
    options.push(
      singleOption(bestPickup, requestedLineIds, {
        reason:
          saving > 0
            ? 'Collect yourself — cheaper than any delivery'
            : 'Collect yourself — costs more than delivery here',
        savingVsBaseline: saving,
        baselineLabel: best.brand,
        extraStores: 0,
        notes: [],
      }),
    );
  }

  for (const candidate of input.driveOptions ?? []) {
    const opt = driveOption(candidate, requestedLineIds, constants, best);
    if (opt !== undefined) options.push(opt);
  }

  return { options: rank(options, constants, best), rejected, warnings };
}

// ---------------------------------------------------------------------------

function singleOption(
  q: StorefrontQuote,
  requestedLineIds: readonly string[],
  explanation: PurchaseOption['explanation'],
): PurchaseOption {
  const priced = new Set(q.lines.map((l) => l.lineId));
  return {
    kind: q.serviceType === 'pickup' ? 'pickup' : 'single_delivered',
    label: q.brand,
    legs: [
      {
        storefrontId: q.storefrontId,
        brand: q.brand,
        itemsSubtotal: q.itemsSubtotal,
        deliveryFee: q.deliveryFee,
        lineIds: q.lines.map((l) => l.lineId),
      },
    ],
    itemsSubtotal: q.itemsSubtotal,
    fees: q.deliveryFee,
    cashCost: q.deliveredTotal,
    timeCost: agorot(0),
    coverageRatio: coverageRatio(q),
    unpricedLineIds: requestedLineIds.filter((id) => !priced.has(id)),
    substitutedLineCount: q.lines.filter((l) => l.substituted).length,
    explanation,
  };
}

/**
 * Greedy two-store split: take the cheapest complete basket as the anchor, then
 * for every other storefront move the lines it prices more cheaply and see
 * whether the saving clears a second delivery fee plus the household's own
 * threshold for tolerating a second delivery.
 *
 * Greedy rather than exhaustive on purpose: with ~15 storefronts and a hard cap
 * of two stores the search space is small, and a family can only reason about a
 * split it can describe.
 */
function bestSplit(
  delivery: readonly StorefrontQuote[],
  requestedLineIds: readonly string[],
  constants: HouseholdConstants,
  anchor: StorefrontQuote,
): PurchaseOption | undefined {
  let bestOption: PurchaseOption | undefined;
  let bestSaving = constants.minSavingForSecondStore;

  const anchorPrices = new Map(anchor.lines.map((l) => [l.lineId, l]));

  for (const other of delivery) {
    if (other.storefrontId === anchor.storefrontId) continue;

    const moved: QuotedLine[] = [];
    const kept: QuotedLine[] = [];
    for (const line of anchor.lines) {
      const rival = other.lines.find((l) => l.lineId === line.lineId);
      if (rival !== undefined && rival.lineTotal < line.lineTotal) moved.push(rival);
      else kept.push(line);
    }
    if (moved.length === 0 || kept.length === 0) continue;

    const keptSubtotal = addAgorot(...kept.map((l) => l.lineTotal));
    const movedSubtotal = addAgorot(...moved.map((l) => l.lineTotal));

    // A leg that no longer clears its storefront's minimum is not a real leg.
    if (other.minimumOrder !== undefined && movedSubtotal < other.minimumOrder) continue;
    if (anchor.minimumOrder !== undefined && keptSubtotal < anchor.minimumOrder) continue;

    const total = addAgorot(keptSubtotal, anchor.deliveryFee, movedSubtotal, other.deliveryFee);
    const saving = subAgorot(anchor.deliveredTotal, total);
    if (saving <= bestSaving) continue;

    bestSaving = saving;
    const legs: OptionLeg[] = [
      {
        storefrontId: anchor.storefrontId,
        brand: anchor.brand,
        itemsSubtotal: keptSubtotal,
        deliveryFee: anchor.deliveryFee,
        lineIds: kept.map((l) => l.lineId),
      },
      {
        storefrontId: other.storefrontId,
        brand: other.brand,
        itemsSubtotal: movedSubtotal,
        deliveryFee: other.deliveryFee,
        lineIds: moved.map((l) => l.lineId),
      },
    ];
    const priced = new Set([...kept, ...moved].map((l) => l.lineId));
    bestOption = {
      kind: 'split_delivered',
      label: `${anchor.brand} + ${other.brand}`,
      legs,
      itemsSubtotal: addAgorot(keptSubtotal, movedSubtotal),
      fees: addAgorot(anchor.deliveryFee, other.deliveryFee),
      cashCost: total,
      timeCost: agorot(0),
      coverageRatio: priced.size / Math.max(requestedLineIds.length, 1),
      unpricedLineIds: requestedLineIds.filter((id) => !priced.has(id)),
      substitutedLineCount: [...kept, ...moved].filter((l) => l.substituted).length,
      explanation: {
        reason: `${moved.length} lines are cheaper at ${other.brand}, and the saving clears a second delivery fee`,
        savingVsBaseline: saving,
        baselineLabel: anchor.brand,
        extraStores: 1,
        notes: [`Second delivery fee of ${other.deliveryFee} agorot is already included`],
      },
    };
    void anchorPrices;
  }

  return bestOption;
}

function driveOption(
  candidate: DriveCandidate,
  requestedLineIds: readonly string[],
  constants: HouseholdConstants,
  baseline: StorefrontQuote,
): PurchaseOption | undefined {
  const { quote, travel } = candidate;
  if (coverageRatio(quote) < constants.minCoverageRatio) return undefined;

  const cash = addAgorot(quote.itemsSubtotal, travel.fuelCost, travel.parkingCost);
  const saving = subAgorot(baseline.deliveredTotal, cash);
  if (saving < constants.minSavingToDrive) return undefined;

  const timeCost = scaleAgorot(constants.valueOfTimePerHour, travel.roundTripMinutes / 60);
  const priced = new Set(quote.lines.map((l) => l.lineId));

  return {
    kind: 'drive',
    label: `${quote.brand} — drive yourself`,
    legs: [
      {
        storefrontId: quote.storefrontId,
        brand: quote.brand,
        itemsSubtotal: quote.itemsSubtotal,
        deliveryFee: agorot(0),
        lineIds: quote.lines.map((l) => l.lineId),
      },
    ],
    itemsSubtotal: quote.itemsSubtotal,
    fees: addAgorot(travel.fuelCost, travel.parkingCost),
    travel,
    cashCost: cash,
    timeCost,
    coverageRatio: coverageRatio(quote),
    unpricedLineIds: requestedLineIds.filter((id) => !priced.has(id)),
    substitutedLineCount: quote.lines.filter((l) => l.substituted).length,
    explanation: {
      reason: `Cheaper in store, and the saving clears the ${travel.distanceKm} km round trip`,
      savingVsBaseline: saving,
      baselineLabel: baseline.brand,
      extraStores: 0,
      notes: [`${travel.roundTripMinutes} minutes of driving, priced separately from cash`],
    },
  };
}

/** Flags lines whose price varies implausibly across chains — a resolution bug. */
function detectSuspiciousLines(quotes: readonly StorefrontQuote[]): string[] {
  const byLine = new Map<string, { query: string; prices: number[] }>();
  for (const q of quotes) {
    for (const l of q.lines) {
      const e = byLine.get(l.lineId) ?? { query: l.query, prices: [] };
      e.prices.push(l.unitPrice);
      byLine.set(l.lineId, e);
    }
  }
  const out: string[] = [];
  for (const [lineId, { query, prices }] of byLine) {
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    if (lo > 0 && hi / lo >= SUSPICIOUS_PRICE_RATIO) {
      out.push(
        `Line "${query}" (${lineId}) varies ${(hi / lo).toFixed(1)}x across chains — probably matched to different products, not a bargain`,
      );
    }
  }
  return out;
}

/** Cheapest cash first; ties broken toward fewer stores, then fewer substitutions. */
function rank(
  options: readonly PurchaseOption[],
  _constants: HouseholdConstants,
  _baseline: StorefrontQuote,
): readonly PurchaseOption[] {
  return [...options].sort(
    (a, b) =>
      a.cashCost - b.cashCost ||
      a.legs.length - b.legs.length ||
      a.substitutedLineCount - b.substitutedLineCount,
  );
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
