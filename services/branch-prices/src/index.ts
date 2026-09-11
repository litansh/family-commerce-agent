/**
 * In-store prices: what the list costs if the family drives to a branch.
 *
 * The chains publish every branch's full price list daily (price transparency
 * law). This package reads those files, finds the branches near a household,
 * and prices a list at each — so the compare screen can show "at Rami Levy
 * Glilot, 4 km away, the same basket is ₪412 + about ₪10 of driving".
 */
import type { Agorot, QuotedLine, StorefrontQuote, TravelCost } from '@fca/domain';
import { haversineKm, travelTo, type LatLng } from './geo.ts';
import { sameCity, type SettlementNames } from './cbs.ts';
import type { Branch, PriceIndex } from './xml.ts';

export * from './xml.ts';
export * from './geo.ts';
export * from './cbs.ts';
export * from './portals.ts';

export interface GeoBranch extends Branch {
  readonly chain: string;
  readonly brand: string;
  readonly lat: number;
  readonly lng: number;
}

/** A branch worth driving to: near enough, and the closest few of its chain. */
export interface NearbyBranch extends GeoBranch {
  readonly distanceKm: number;
}

/** The branches of one chain that sit in the household's city, by published name or CBS code. */
export function branchesInCity(branches: readonly Branch[], city: string, names: SettlementNames): Branch[] {
  return branches.filter((b) => sameCity(b.city, city, names));
}

/** The closest branches to home, at most `perChain` of each chain, within `radiusKm`. */
export function nearestBranches(branches: readonly GeoBranch[], home: LatLng, opts: { radiusKm: number; perChain: number }): NearbyBranch[] {
  const withDistance = branches.map((b) => ({ ...b, distanceKm: Math.round(haversineKm(home, b) * 10) / 10 })).filter((b) => b.distanceKm <= opts.radiusKm).sort((a, b) => a.distanceKm - b.distanceKm);
  const perChain = new Map<string, number>();
  return withDistance.filter((b) => { const n = perChain.get(b.chain) ?? 0; if (n >= opts.perChain) return false; perChain.set(b.chain, n + 1); return true; });
}

export interface ListLineForPricing { readonly id: string; readonly query: string; readonly gtin?: string; readonly qty: number }

export interface BranchQuote {
  readonly quote: StorefrontQuote;
  readonly travel: TravelCost;
  readonly branch: NearbyBranch;
}

/** Price a list at one branch by barcode. Lines without a barcode, or absent from the branch, stay unpriced. */
export function priceAtBranch(branch: NearbyBranch, index: PriceIndex, lines: readonly ListLineForPricing[], constants: { costPerKm: Agorot; parkingCost: Agorot }): BranchQuote {
  const quoted: QuotedLine[] = [];
  for (const l of lines) {
    const hit = l.gtin ? index[l.gtin] : undefined;
    if (!hit) continue;
    const unit = hit[0] as Agorot;
    quoted.push({ lineId: l.id, query: l.query, productName: hit[1], gtin: l.gtin!, qty: l.qty, unitPrice: unit, lineTotal: (unit * l.qty) as Agorot, substituted: false, clubOnly: false, resolutionSource: 'gtin' });
  }
  const subtotal = quoted.reduce((s, q) => s + q.lineTotal, 0) as Agorot;
  const quote: StorefrontQuote = {
    storefrontId: `branch:${branch.chain}:${branch.storeId}`,
    brand: `${branch.brand} ${branch.name}`.trim(),
    chainId: branch.chainId,
    serviceType: 'pickup',
    itemsSubtotal: subtotal,
    deliveryFee: 0 as Agorot,
    deliveredTotal: subtotal,
    meetsMinimum: true,
    deliveryTermsConfidence: 'verified',
    priceFeedStale: false,
    requestedLines: lines.length,
    pricedLines: quoted.length,
    lines: quoted,
  };
  return { quote, travel: travelTo(branch.distanceKm, constants), branch };
}
