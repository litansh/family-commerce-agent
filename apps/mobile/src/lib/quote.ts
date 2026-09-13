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

/**
 * The line an order sends to one store's leg: this store's own barcode when it priced the line
 * itself, the shared resolution only as a fallback — the same rule `productAt` gives a screen, so an
 * order can never send a leg the winner's barcode for a product that leg's own store never priced
 * (docs/design/item-identity.md). `line` carries the household's words and its own confirmed gtin.
 */
export function orderLineAt(quote: QuoteLike, storefrontId: string, lineId: string, line: { query: string; gtin?: string; brand?: string; amount?: number; unit?: string; packQty?: number }) {
  const p = productAt(quote, storefrontId, lineId);
  const gtin = p.gtin ?? line.gtin;
  return { query: line.query, ...(gtin ? { gtin } : {}), ...(line.brand ? { brand: line.brand } : {}), ...(line.amount !== undefined ? { amount: line.amount } : {}), ...(line.unit ? { unit: line.unit } : {}), ...(line.packQty !== undefined ? { packQty: line.packQty } : {}) };
}
