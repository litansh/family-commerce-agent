/**
 * Reading a compare the way the family will buy it.
 *
 * A quote holds two different answers to "which product is this line?": `quotedLines`, one
 * resolution for the whole compare, and `storefrontLines`, what each store actually priced and what
 * its cart recipe will add. They disagree often — a line asked as "חלב 3%" is a 2 ℓ bottle at one
 * chain and a 1 ℓ bag at the next — so every screen that names a product inside a store's leg must
 * ask the same question the same way: this store's own product, the shared resolution only as a
 * fallback (docs/design/item-identity.md).
 *
 * Kept free of React and of `./api` on purpose: `e2e/split-naming.mjs` runs it over a real compare.
 */
export interface QuoteLineProduct { gtin?: string; productName: string; link?: string; substituted?: boolean; reason?: string }
export interface QuoteLike {
  storefrontLines?: Record<string, Record<string, QuoteLineProduct>>;
  quotedLines: Record<string, { gtin?: string; productName: string; link?: string; imageUrl?: string | null }>;
}

/**
 * The product a given store puts behind a line: its own, or the compare's resolution when the store
 * priced the line without naming one. `own` says which, because a screen inside a store's leg may
 * only claim what that store will really add.
 */
export function productAt(quote: QuoteLike, storefrontId: string, lineId: string): { gtin?: string; productName?: string; link?: string; own: boolean } {
  const sl = quote.storefrontLines?.[storefrontId]?.[lineId];
  const ql = quote.quotedLines[lineId];
  if (sl) return { ...(sl.gtin ? { gtin: sl.gtin } : ql?.gtin ? { gtin: ql.gtin } : {}), productName: sl.productName, ...(sl.link ? { link: sl.link } : {}), own: true };
  return { ...(ql?.gtin ? { gtin: ql.gtin } : {}), ...(ql?.productName ? { productName: ql.productName } : {}), ...(ql?.link ? { link: ql.link } : {}), own: false };
}
