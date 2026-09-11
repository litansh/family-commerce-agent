import type { Agorot } from './money.ts';

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

/** What the household asked for, before it is resolved to a product. */
export interface ListLine {
  readonly id: string;
  /** The household's own words, e.g. "חלב 3%". */
  readonly query: string;
  /** A GTIN the household has confirmed before. Short-circuits resolution. */
  readonly gtin?: string;
  /**
   * The brand the family asked for, e.g. "תנובה".
   *
   * A named brand is an instruction, not a hint: resolution must return that
   * brand. Cheaper alternatives are offered alongside it and never swapped in.
   */
  readonly brand?: string;
  readonly amount?: number;
  readonly unit?: string;
  readonly packQty?: number;
}

// ---------------------------------------------------------------------------
// Product choice — brand and size, decided by the family
// ---------------------------------------------------------------------------

/** A concrete product the line could resolve to. */
export interface ProductCandidate {
  readonly productId: string;
  readonly gtin?: string;
  readonly name: string;
  /** Normalised brand, e.g. "תנובה" for all of תנובה / תנובה בע"מ / תנובה חלב. */
  readonly brand?: string;
  /** Brand exactly as the catalogue spells it. Kept for display and debugging. */
  readonly rawBrand?: string;
  readonly sizeQty?: number;
  readonly sizeUnit?: string;
  /** Cheapest price seen anywhere. Indicative only — the quote decides. */
  readonly fromPrice?: Agorot;
  /**
   * Price per 100ml / 100g / piece. The only honest way to compare a 1L bag
   * against a 2L carton, or a 100g pot against a 250g tub.
   */
  readonly unitPrice?: Agorot;
  readonly unitBasis?: string;
  /** How many chains currently price it. Zero means it cannot be bought. */
  readonly pricedAtChains: number;
}

/** How an alternative relates to what the family asked for. */
export type AlternativeRelation =
  | 'same_brand_other_size'
  | 'other_brand'
  | 'same_brand_other_variant';

export interface ProductAlternative {
  readonly candidate: ProductCandidate;
  readonly relation: AlternativeRelation;
  /**
   * Difference in unit price against the chosen product, per the shared basis.
   * Negative means the alternative is cheaper per 100ml/100g/piece.
   */
  readonly unitPriceDelta?: Agorot;
  /** Percent cheaper (positive) or dearer (negative), rounded. */
  readonly percentDelta?: number;
  readonly reason: string;
}

/**
 * The resolution of one line: what we will buy, and what else the family could
 * have. The chosen product always honours an explicitly named brand.
 */
export interface ProductChoice {
  readonly lineId: string;
  readonly query: string;
  readonly requestedBrand?: string;
  readonly chosen: ProductCandidate;
  /** Ranked cheapest-per-unit first. Offered, never auto-applied. */
  readonly alternatives: readonly ProductAlternative[];
  readonly source: ResolutionSource;
  /** True when the family named a brand and we honoured it. */
  readonly brandHonoured: boolean;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Quotes — what a QuoteProvider returns
// ---------------------------------------------------------------------------

export type ServiceType = 'delivery' | 'pickup';

/** How a line was matched, for measuring resolution quality (Phase 1 gate). */
export type ResolutionSource = 'memory' | 'gtin' | 'search' | 'llm' | 'provider';

export interface QuotedLine {
  readonly lineId: string;
  readonly query: string;
  readonly productName: string;
  readonly gtin?: string;
  readonly qty: number;
  readonly unitPrice: Agorot;
  readonly lineTotal: Agorot;
  readonly substituted: boolean;
  readonly substitutionReason?: string;
  readonly clubOnly: boolean;
  readonly resolutionSource: ResolutionSource;
  /** Deep link to the item on the retailer's site. Our unbreakable cart path. */
  readonly link?: string;
}

/** One storefront's answer for the whole basket. */
export interface StorefrontQuote {
  readonly storefrontId: string;
  readonly brand: string;
  readonly chainId: string;
  readonly serviceType: ServiceType;
  readonly itemsSubtotal: Agorot;
  readonly deliveryFee: Agorot;
  readonly deliveredTotal: Agorot;
  readonly meetsMinimum: boolean;
  readonly minimumOrder?: Agorot;
  readonly requestedLines: number;
  readonly pricedLines: number;
  readonly lines: readonly QuotedLine[];
  readonly deliveryTermsConfidence: 'verified' | 'assumed' | 'unknown';
  readonly priceFeedStale: boolean;
}

/** Coverage as a 0..1 ratio. Derived, never taken from the provider on trust. */
export const coverageRatio = (q: StorefrontQuote): number =>
  q.requestedLines === 0 ? 0 : q.pricedLines / q.requestedLines;

// ---------------------------------------------------------------------------
// Household constants — the family's own trade-offs, never our defaults
// ---------------------------------------------------------------------------

export interface HouseholdConstants {
  readonly costPerKm: Agorot;
  readonly parkingCost: Agorot;
  /**
   * What an hour of the family's time is worth to them, in agorot.
   * Zero means "do not price my time" and is the honest default — time has no
   * objective monetary value and we never invent one.
   */
  readonly valueOfTimePerHour: Agorot;
  /** A second retailer must beat the single-store option by at least this much. */
  readonly minSavingForSecondStore: Agorot;
  /** Driving must beat the best delivered option by at least this much. */
  readonly minSavingToDrive: Agorot;
  /**
   * Minimum share of the list a storefront must price to be offered at all.
   *
   * A partial basket causes the top-up trip the household is trying to avoid,
   * so a cheap-but-incomplete storefront is not an option however cheap — the
   * Wolt storefronts that price 10 of 36 lines are not cheap, they are empty.
   *
   * But the floor must not be so high that missing two lines disqualifies a
   * whole chain: at 0.95 a 36-line list rejected every storefront but two and
   * threw away a profitable split. Missing lines are surfaced per option
   * instead, so the family sees the gap and decides.
   */
  readonly minCoverageRatio: number;
  /** Hard ceiling on storefronts in one shop. Two, on measured evidence. */
  readonly maxStores: number;
}

export const DEFAULT_CONSTANTS: HouseholdConstants = {
  costPerKm: 250 as Agorot,
  parkingCost: 0 as Agorot,
  valueOfTimePerHour: 0 as Agorot,
  minSavingForSecondStore: 2000 as Agorot,
  minSavingToDrive: 4000 as Agorot,
  minCoverageRatio: 0.9,
  maxStores: 2,
};

// ---------------------------------------------------------------------------
// Options — what the optimizer produces
// ---------------------------------------------------------------------------

export type OptionKind =
  | 'single_delivered'
  | 'split_delivered'
  | 'pickup'
  | 'drive';

export interface TravelCost {
  readonly distanceKm: number;
  readonly roundTripMinutes: number;
  readonly fuelCost: Agorot;
  readonly parkingCost: Agorot;
}

export interface OptionLeg {
  readonly storefrontId: string;
  readonly brand: string;
  readonly itemsSubtotal: Agorot;
  readonly deliveryFee: Agorot;
  readonly lineIds: readonly string[];
}

/**
 * A costed way to buy the list.
 *
 * cashCost and timeCost are reported separately and are NEVER summed into a
 * single headline figure. Time has no objective monetary value; the household
 * decides whether to look at timeCost at all.
 */
export interface PurchaseOption {
  readonly kind: OptionKind;
  readonly label: string;
  readonly legs: readonly OptionLeg[];
  readonly itemsSubtotal: Agorot;
  readonly fees: Agorot;
  readonly travel?: TravelCost;
  /** Money actually leaving the account. The only figure we call "cost". */
  readonly cashCost: Agorot;
  /** Priced time, shown alongside cashCost and never added to it. */
  readonly timeCost: Agorot;
  readonly coverageRatio: number;
  readonly unpricedLineIds: readonly string[];
  /**
   * What the missing lines would cost at the cheapest store that has them - so a basket
   * that leaves an item out is ranked as if it were completed, never as "cheaper".
   * 0 for a complete option; undefined when a missing line is priced nowhere.
   */
  readonly missingEstimate?: Agorot;
  readonly substitutedLineCount: number;
  /** Raw numbers behind the ranking. The LLM renders this; it never computes it. */
  readonly explanation: OptionExplanation;
}

export interface OptionExplanation {
  readonly reason: string;
  readonly savingVsBaseline: Agorot;
  readonly baselineLabel: string;
  readonly extraStores: number;
  readonly notes: readonly string[];
}
