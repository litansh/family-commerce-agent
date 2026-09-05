import type { ListLine, ProductCandidate, StorefrontQuote } from '@fca/domain';

export interface QuoteRequest {
  readonly lines: readonly ListLine[];
  readonly address: string;
  readonly serviceType?: 'delivery' | 'pickup';
  readonly memberships?: readonly string[];
}

export interface QuoteResponse {
  readonly quotes: readonly StorefrontQuote[];
  /** Provider-side notes on how each line was interpreted. Phase 1 evidence. */
  readonly assumptions: readonly ResolutionAssumption[];
  readonly providerId: string;
  readonly latencyMs: number;
  /** Verbatim provider payload, cached as a regression fixture. */
  readonly raw: unknown;
}

export interface ResolutionAssumption {
  readonly lineId: string;
  readonly query: string;
  readonly selectedName: string;
  /** e.g. generic_default, commodity_best_effort. Provider vocabulary. */
  readonly kind: string;
  readonly reason: string;
  readonly message: string;
}

/**
 * The seam that keeps a rented price engine replaceable.
 *
 * Domain code depends on this interface and never on an MCP client, an HTTP
 * shape, or a vendor's field names. SuperMCP is free, unversioned and carries no
 * SLA, so the day it changes or disappears must cost us one implementation, not
 * a rewrite.
 */
export interface QuoteProvider {
  readonly id: string;
  quoteBasket(req: QuoteRequest): Promise<QuoteResponse>;
}

// ---------------------------------------------------------------------------
// Catalogue search — how a line becomes a brand-and-size choice
// ---------------------------------------------------------------------------

export interface CatalogSearchRequest {
  readonly query: string;
  /** Filter to a brand the family named. Partial match on the provider side. */
  readonly brand?: string;
  readonly gtin?: string;
  readonly limit?: number;
  /** Restricts results to products actually priced near the household. */
  readonly location?: string;
}

/**
 * Catalogue lookup, separate from basket pricing.
 *
 * Split from QuoteProvider because the two answer different questions and fail
 * differently: search is interactive and cheap, quoting is a whole-basket
 * operation that takes ~15 seconds.
 */
export interface CatalogProvider {
  readonly id: string;
  searchProducts(req: CatalogSearchRequest): Promise<readonly ProductCandidate[]>;
}
