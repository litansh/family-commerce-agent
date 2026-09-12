/**
 * Grouping catalogue candidates into variants (docs/design/item-identity.md).
 *
 * The unit a family compares is the variant, not the product: size and the category's own
 * defining attribute (fat % for milk and cream, grind for coffee, count for eggs — which is
 * just its size in pieces). Brand is kept aside on purpose — "12 מותגים · ₪5.90–8.40" is the
 * whole point, not something to search around.
 *
 * Deterministic, like brand.ts: a family's own words must group the same way every time.
 */
import { normalizeBrand, stripBrandFromName } from './brand.ts';
import { agorot, type Agorot } from './money.ts';
import { parseSizeFromName, stripSizeFromName } from './size.ts';
import type { ProductCandidate } from './types.ts';

/** Packaging and marketing words that describe how a product is sold, not what it is. */
const FILLER = [
  'שקית', 'בקבוק', 'קרטון', 'מארז', 'שישיה', 'שישייה', 'הומוגני', 'מהדרין', 'שומן',
  'טרי', 'טבעי', 'אורגני', 'משפחתי', 'רגיל', 'מיוחד', 'פרימיום',
];

const PERCENT = /\d+(?:\.\d+)?%/;
const GRIND: readonly string[] = ['טחון', 'פולים', 'נמס', 'קפסולות'];

/** The category's own defining attribute in a name — a fat/fat-substitute percentage, or a coffee grind. Empty when none applies. */
function attrsOf(name: string): string {
  const pct = PERCENT.exec(name)?.[0];
  if (pct) return pct;
  return GRIND.find((g) => name.includes(g)) ?? '';
}

/** The size as the catalogue states it; the name only when the catalogue does not. */
function sizeOf(candidate: ProductCandidate): { qty: number; unit: string } | undefined {
  if (candidate.sizeQty !== undefined && candidate.sizeQty > 0 && candidate.sizeUnit) {
    return { qty: candidate.sizeQty, unit: candidate.sizeUnit.toLowerCase() };
  }
  return parseSizeFromName(candidate.name);
}

export interface VariantKey {
  /** What the product is, brand, size and defining attribute stripped away: "חלב", "שמנת מתוקה". */
  readonly base: string;
  /** The category's defining attribute, e.g. "3%", "טחון". Empty when the category has none. */
  readonly attrs: string;
  readonly size?: { readonly qty: number; readonly unit: string };
}

/** What makes two candidates the same thing a family would compare, brand aside. */
export function variantKey(candidate: ProductCandidate): VariantKey {
  const attrs = attrsOf(candidate.name);
  let base = stripBrandFromName(candidate.name);
  base = stripSizeFromName(base);
  if (attrs) base = base.replace(attrs, ' ');
  for (const f of FILLER) base = base.replace(new RegExp(f, 'g'), ' ');
  base = base.replace(/\s+/g, ' ').trim();
  const size = sizeOf(candidate);
  return { base, attrs, ...(size ? { size } : {}) };
}

const keyOf = (k: VariantKey): string => `${k.base}|${k.attrs}|${k.size ? `${k.size.qty}${k.size.unit}` : ''}`;

export interface Variant {
  readonly key: string;
  readonly base: string;
  readonly attrs: string;
  readonly size?: { readonly qty: number; readonly unit: string };
  readonly candidates: readonly ProductCandidate[];
  /** Distinct brands behind this variant — "12 מותגים" on the card. */
  readonly brandCount: number;
  readonly priceMin?: Agorot;
  readonly priceMax?: Agorot;
}

/**
 * Candidates for one line, collapsed into the variants a family actually chooses between:
 * the flat list stays available (`groupIntoVariants` groups, it never drops a candidate).
 */
export function groupIntoVariants(candidates: readonly ProductCandidate[]): Variant[] {
  const groups = new Map<string, { key: VariantKey; candidates: ProductCandidate[] }>();
  for (const c of candidates) {
    const k = variantKey(c);
    const id = keyOf(k);
    const g = groups.get(id);
    if (g) g.candidates.push(c); else groups.set(id, { key: k, candidates: [c] });
  }
  return [...groups.values()]
    .map(({ key, candidates: cands }): Variant => {
      const brands = new Set(cands.map((c) => normalizeBrand(c.brand)).filter((b): b is string => b !== undefined));
      const prices = cands.map((c) => c.fromPrice).filter((p): p is Agorot => p !== undefined);
      return {
        key: keyOf(key),
        base: key.base,
        attrs: key.attrs,
        ...(key.size ? { size: key.size } : {}),
        candidates: cands,
        brandCount: brands.size,
        ...(prices.length ? { priceMin: agorot(Math.min(...prices)), priceMax: agorot(Math.max(...prices)) } : {}),
      };
    })
    .sort((a, b) => b.candidates.length - a.candidates.length || (a.priceMin ?? 0) - (b.priceMin ?? 0));
}
