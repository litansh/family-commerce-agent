/**
 * Coupons.
 *
 * Two kinds reach a family: public promotions the catalogue already prices
 * in, and personal coupons loaded on a retailer account ("My Shufersal").
 * The second kind is invisible to every comparison app, and it changes which
 * chain wins. The worker reads them with the family's session; this module
 * applies them to a quote — deterministically, so a coupon can never be
 * "sort of" applied.
 */
import { addAgorot, agorot, scaleAgorot, subAgorot, type Agorot } from './money.ts';
import type { QuotedLine, StorefrontQuote } from './types.ts';

export interface Coupon {
  readonly id: string;
  readonly retailer: string;
  /** Match by barcode when the retailer gives one; otherwise by a name fragment. */
  readonly gtin?: string;
  readonly nameMatch?: string;
  readonly title: string;
  /** Exactly one of these. */
  readonly amountOff?: Agorot;
  readonly percentOff?: number;
  /** Minimum units of the product in the basket for the coupon to apply. */
  readonly minQty?: number;
  readonly expiresAt?: string;
}

export interface CouponApplication {
  readonly couponId: string;
  readonly lineId: string;
  readonly title: string;
  readonly saving: Agorot;
}

export interface CouponedQuote extends StorefrontQuote {
  readonly coupons: readonly CouponApplication[];
  readonly couponSavings: Agorot;
}

function matches(c: Coupon, line: QuotedLine): boolean {
  if (c.gtin !== undefined) return line.gtin === c.gtin;
  if (c.nameMatch !== undefined) return line.productName.includes(c.nameMatch);
  return false;
}

/**
 * Apply a retailer's coupons to that retailer's quote. Each coupon applies
 * at most once, to the first matching line, and only if the basket holds
 * enough of the product. The delivered total drops by the saving; nothing
 * else about the quote changes.
 */
export function applyCoupons(quote: StorefrontQuote, coupons: readonly Coupon[], now: Date = new Date()): CouponedQuote {
  const used = new Set<string>();
  const applied: CouponApplication[] = [];
  for (const c of coupons) {
    if (c.retailer !== quote.chainId && c.retailer !== quote.storefrontId && !quote.storefrontId.includes(c.retailer)) continue;
    if (c.expiresAt !== undefined && Date.parse(c.expiresAt) < now.getTime()) continue;
    const line = quote.lines.find((l) => matches(c, l) && !used.has(l.lineId) && l.qty >= (c.minQty ?? 1));
    if (line === undefined) continue;
    const saving: Agorot =
      c.amountOff !== undefined ? c.amountOff
      : c.percentOff !== undefined ? scaleAgorot(line.lineTotal, c.percentOff / 100)
      : agorot(0);
    if (saving <= 0) continue;
    used.add(line.lineId);
    applied.push({ couponId: c.id, lineId: line.lineId, title: c.title, saving: agorot(Math.min(saving, line.lineTotal)) });
  }
  const couponSavings = addAgorot(...applied.map((a) => a.saving));
  return {
    ...quote,
    coupons: applied,
    couponSavings,
    deliveredTotal: subAgorot(quote.deliveredTotal, couponSavings),
  };
}
