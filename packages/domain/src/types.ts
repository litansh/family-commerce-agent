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
  readonly amount?: number;
  readonly unit?: string;
  readonly packQty?: number;
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
