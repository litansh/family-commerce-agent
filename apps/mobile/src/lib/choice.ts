/**
 * What a list line *means* — the family's choice (docs/design/item-identity.md).
 *
 * Three layers, one visible: the **line** is the family's words, the **choice** is
 * "כל מותג" or one pinned product, and the **item** is the barcode a store actually
 * prices. The choice is the only one the family is ever asked about, and it lives on
 * the line itself: a `gtin` on a line is the family saying "this one", its absence is
 * "whatever is cheapest that is still this thing".
 *
 * Everything here is pure so `test/choice.test.ts` can hold the line: the add flow
 * pinning a barcode on every tap is what made "חלב" mean one brand's carton at every
 * store, and a comparison of a 1 ℓ carton against a 2 ℓ bottle look like a saving.
 */
import { agorot, formatSize, normalizeBrand, sizeFromName, type Agorot } from '@fca/domain';
import type { SearchHit, SearchVariant } from './api';
import type { Line } from './store';

/** "כל מותג" (cheapest equivalent, per store) or one barcode, everywhere. */
export type Choice = 'any' | 'pinned';

/** A barcode on the line is the family saying "this one"; nothing else pins. */
export const choiceOf = (l: Pick<Line, 'gtin'>): Choice => (l.gtin ? 'pinned' : 'any');

/** A stable identity for a variant row. The API groups; it does not send the key. */
export const variantId = (v: SearchVariant): string =>
  `${v.base}|${v.attrs}|${v.size ? `${v.size.qty}${v.size.unit}` : ''}`;

/** The size as a person says it: "1 ליטר", "250 גרם". */
export const sizeWords = (size?: { qty: number; unit: string }): string | undefined =>
  size ? formatSize(size.qty, size.unit) ?? `${size.qty} ${size.unit}` : undefined;

/**
 * The words a variant puts on the list: what it is, its defining attribute, its size —
 * "חלב 3% 1 ליטר". The size has to be in the words: the quote receives only
 * `query`/`gtin`/`brand`/quantity, so a line that drops "1 ליטר" invites a store to
 * price the 2 ℓ bottle and call it a saving (promise 4).
 */
export const variantWords = (v: SearchVariant): string =>
  [v.base, v.attrs, sizeWords(v.size)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** The cheapest priced product behind a variant: its picture, and — when it is alone — its barcode. */
export function cheapestOf(hits: readonly SearchHit[]): SearchHit | undefined {
  const priced = hits.filter((h) => h.fromPrice !== undefined);
  return [...(priced.length ? priced : hits)].sort((a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity))[0];
}

/** A variant no store that reaches the family carries. Shown greyed and named, never dropped. */
export const carriedNearby = (v: SearchVariant): boolean => v.products.some((p) => p.pricedAtChains > 0);

/** One product behind the variant means there is nothing to choose: the product *is* the card. */
export const soleProduct = (v: SearchVariant): SearchHit | undefined =>
  v.products.length === 1 ? v.products[0] : undefined;

/**
 * A **כל מותג** line from a variant card: the variant's own words, and deliberately no
 * barcode and no brand — those two fields are the pin, and the compare prices each store's
 * own cheapest product of the variant, naming it per store.
 */
export function lineFromVariant(v: SearchVariant): Omit<Line, 'id'> {
  const size = sizeWords(v.size);
  const pic = cheapestOf(v.products);
  return {
    query: variantWords(v),
    ...(size ? { size } : {}),
    ...(pic?.imageUrl ? { imageUrl: pic.imageUrl } : {}),
  };
}

/** The pack as a person says it: the catalogue's own fields, the product's name when it has none. */
const packOf = (h: SearchHit): string | undefined => formatSize(h.sizeQty, h.sizeUnit) ?? sizeFromName(h.name);

/** A **מותג מקובע** line: one product, one barcode, the same everywhere. */
export function lineFromHit(h: SearchHit): Omit<Line, 'id'> {
  const size = packOf(h);
  return {
    query: h.name,
    productName: h.name,
    ...(h.gtin ? { gtin: h.gtin } : {}),
    ...(h.brand ? { brand: h.brand } : {}),
    ...(size ? { size } : {}),
    imageUrl: h.imageUrl,
  };
}

export interface BrandGroup {
  /** Normalised brand — תנובה for all of תנובה / תנובה בע"מ / תנובה חלב. */
  readonly brand: string;
  readonly products: readonly SearchHit[];
  /** The one this brand would be bought as: its cheapest priced product. */
  readonly cheapest: SearchHit;
  readonly priceMin?: Agorot;
  readonly priceMax?: Agorot;
}

/** Every price a set of candidates was seen at. Money is integer agorot, never a float. */
const pricesOf = (hits: readonly SearchHit[]): Agorot[] =>
  hits.flatMap((h) => (h.fromPrice !== undefined ? [h.fromPrice] : []));

/**
 * The brands behind one line's candidates, each with its own price range — the sheet's rows.
 * Cheapest brand first, brands nobody prices last; a product with no brand at all is not a
 * brand to choose, so it is left to the flat list.
 */
export function brandGroups(hits: readonly SearchHit[]): BrandGroup[] {
  const by = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const b = normalizeBrand(h.brand) ?? h.brand;
    if (!b) continue;
    const g = by.get(b);
    if (g) g.push(h); else by.set(b, [h]);
  }
  return [...by.entries()]
    .map(([brand, products]): BrandGroup | null => {
      const cheapest = cheapestOf(products);
      if (!cheapest) return null;
      const prices = pricesOf(products);
      return {
        brand, products, cheapest,
        ...(prices.length ? { priceMin: agorot(Math.min(...prices)), priceMax: agorot(Math.max(...prices)) } : {}),
      };
    })
    .filter((g): g is BrandGroup => g !== null)
    .sort((a, b) => (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity) || b.products.length - a.products.length);
}

/** The whole span "כל מותג" spends across, for the sheet's first row. */
export function spanOf(hits: readonly SearchHit[]): { min: Agorot; max: Agorot } | undefined {
  const prices = pricesOf(hits);
  return prices.length ? { min: agorot(Math.min(...prices)), max: agorot(Math.max(...prices)) } : undefined;
}

/**
 * Pin a brand onto an existing line. The family's own words stay the line's `query` —
 * the list stays theirs, and memory keeps the same key — while the barcode and brand
 * make the choice.
 */
export function pinBrand(line: Line, g: BrandGroup): Line {
  const h = g.cheapest;
  const size = packOf(h) ?? line.size;
  return {
    ...line,
    productName: h.name,
    ...(h.gtin ? { gtin: h.gtin } : {}),
    brand: g.brand,
    ...(size ? { size } : {}),
    ...(h.imageUrl ? { imageUrl: h.imageUrl } : {}),
  };
}

/**
 * Back to **כל מותג**: the pin comes off. `gtin` and `brand` are dropped rather than
 * blanked — an empty string is still an instruction to the resolver.
 */
export function unpin(line: Line): Line {
  const { gtin: _g, brand: _b, productName: _p, ...rest } = line;
  return rest;
}
