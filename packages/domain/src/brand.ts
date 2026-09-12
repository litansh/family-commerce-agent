/**
 * Brand normalisation.
 *
 * The catalogue spells one firm several ways — "תנובה", "תנובה בע\"מ" and
 * "תנובה חלב" are all Tnuva, and a family that says "תנובה" means all three.
 * Matching on the raw string would silently drop most of a brand's range.
 *
 * This is deliberately a small deterministic function, not an LLM call: a family
 * asking for a brand is giving an instruction, and the answer to "is this Tnuva"
 * must be the same every time.
 */

/** Legal-form and category suffixes that never distinguish two firms. */
const NOISE = [
  'בע"מ',
  'בע״מ',
  'בעמ',
  'ltd',
  'ltd.',
  'inc',
  'חלב',
  'מחלבות',
  'מחלבת',
  'תעשיות',
  'מזון',
  'קבוצת',
  'group',
];

/** Families the catalogue splits but shoppers do not. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['תנובה', 'תנובה'],
  ['שטראוס', 'שטראוס'],
  ['שטראוס עלית', 'שטראוס'],
  ['עלית', 'שטראוס'],
  ['אסם', 'אסם'],
  ['אסם נסטלה', 'אסם'],
  ['יטבתה', 'יטבתה'],
  ['טרה', 'טרה'],
  ['תלמה', 'תלמה'],
  ['סוגת', 'סוגת'],
  ['יכין', 'יכין'],
  ['אנג׳ל', 'אנגל'],
  ['אנג\'ל', 'אנגל'],
  ['angel', 'אנגל'],
  ['דנונה', 'דנונה'],
  ['danone', 'דנונה'],
  ['tnuva', 'תנובה'],
  ['strauss', 'שטראוס'],
  ['osem', 'אסם'],
  ['pampers', 'פמפרס'],
  ['פמפרס', 'פמפרס'],
  ['huggies', 'האגיס'],
  ['coca cola', 'קוקה קולה'],
  ['coca-cola', 'קוקה קולה'],
]);

/**
 * Reduce a catalogue brand string to a stable key.
 * Returns undefined for a blank or unusable brand.
 */
export function normalizeBrand(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;

  let s = raw
    .toLowerCase()
    .replace(/["'׳״]/g, '')
    .replace(/[()\[\]{}.,|*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === '') return undefined;

  for (const noise of NOISE) {
    const n = noise.toLowerCase().replace(/["'׳״]/g, '');
    s = s.replace(new RegExp(`(^|\\s)${escapeRe(n)}(\\s|$)`, 'g'), ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s === '') return undefined;

  return ALIASES.get(s) ?? s;
}

/**
 * Does a candidate brand satisfy a family's request?
 *
 * Whole-token containment, not raw substring. The family may say less than the
 * catalogue ("תנובה" against "תנובה מהדרין") or more, but a bare substring test
 * lets an unrelated request match anything that happens to appear inside it,
 * which quietly hands the family the wrong brand.
 */
export function brandMatches(
  requested: string | undefined,
  candidate: string | null | undefined,
): boolean {
  const want = normalizeBrand(requested);
  if (want === undefined) return true; // no brand asked for: everything matches
  const got = normalizeBrand(candidate);
  if (got === undefined) return false;
  if (got === want) return true;

  const wantTokens = want.split(' ').filter(Boolean);
  const gotTokens = got.split(' ').filter(Boolean);
  const [short, long] =
    wantTokens.length <= gotTokens.length ? [wantTokens, gotTokens] : [gotTokens, wantTokens];
  const longSet = new Set(long);
  return short.length > 0 && short.every((t) => longSet.has(t));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Known brands, for recovering a brand from a product name.
 *
 * The catalogue frequently leaves `brand` null on products whose name plainly
 * carries the brand — "חיתולי פמפרס בייבי דריי מידה 4" came back with no brand
 * at all, so a family asking for Pampers was told no Pampers exists while being
 * shown five Pampers products. Inferring from the name fixes that, and it is the
 * kind of normalisation the aggregator does not do for us.
 */
const KNOWN_BRANDS: readonly string[] = [
  'תנובה',
  'טרה',
  'יטבתה',
  'שטראוס',
  'עלית',
  'אסם',
  'תלמה',
  'סוגת',
  'יכין',
  'אנג׳ל',
  "אנג'ל",
  'דנונה',
  'מולר',
  'פמפרס',
  'האגיס',
  'טיטולים',
  'הבית',
  'מעדנות',
  'גד',
  'שופרסל',
  'רמי לוי',
  'ברילה',
  'אולמיטה',
  'סנו',
  'ניקול',
  'פינוק',
  'קוקה קולה',
  'נסטלה',
  'עוף טוב',
  'זוגלובק',
  'ויסוצקי',
  'אלייט',
];

/**
 * Recover a brand from a product name when the catalogue did not supply one.
 * Returns the longest match, so "רמי לוי" wins over a stray "לוי".
 */
export function inferBrandFromName(name: string | null | undefined): string | undefined {
  if (name == null) return undefined;
  const haystack = name.replace(/["\'׳״]/g, '');
  let best: string | undefined;
  for (const b of KNOWN_BRANDS) {
    const needle = b.replace(/["\'׳״]/g, '');
    if (haystack.includes(needle) && (best === undefined || needle.length > best.length)) {
      best = needle;
    }
  }
  return best === undefined ? undefined : normalizeBrand(best);
}

/**
 * A name with its maker's own text removed and quote marks folded away, so what is left
 * describes the product rather than who makes it or how the catalogue punctuated it.
 */
export function stripBrandFromName(name: string): string {
  const cleaned = name.replace(/["'׳״]/g, '');
  let longest: string | undefined;
  for (const b of KNOWN_BRANDS) {
    const needle = b.replace(/["'׳״]/g, '');
    if (cleaned.includes(needle) && (longest === undefined || needle.length > longest.length)) longest = needle;
  }
  const stripped = longest === undefined ? cleaned : cleaned.replace(new RegExp(escapeRe(longest), 'g'), ' ');
  return stripped.replace(/\s+/g, ' ').trim();
}

/**
 * The consumer brand for a product.
 *
 * The name wins over the catalogue field. The field is frequently the
 * manufacturer or importer rather than the brand a shopper knows: Pampers came
 * back as "PROCTER&GAMBLE" and "דיפלומט", a Tnuva cottage cheese as
 * "מחלבת אלון תבור" — the dairy that makes it. Nobody writes "Procter & Gamble"
 * on a shopping list. Only when the name carries no known brand do we trust the
 * field.
 */
export function resolveBrand(
  rawBrand: string | null | undefined,
  name: string | null | undefined,
): string | undefined {
  return inferBrandFromName(name) ?? normalizeBrand(rawBrand);
}

/**
 * Do the discriminating numbers in a query appear in a product name?
 *
 * "מידה 4" must not resolve to size 1, and "3%" must not resolve to 1%. Any
 * token carrying a digit is treated as a constraint and matched on whole-number
 * boundaries, so "4" does not match the "44" in "44 יח".
 */
export function nameSatisfiesQuery(query: string, name: string): boolean {
  const clean = (x: string): string => x.replace(/["'׳״]/g, '').replace(/\s+/g, ' ');
  const hay = clean(name);
  const numeric = clean(query)
    .split(' ')
    .filter((t) => /\d/.test(t));
  return numeric.every((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\d])${esc}([^\\d]|$)`).test(hay);
  });
}
