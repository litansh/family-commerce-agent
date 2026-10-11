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

/**
 * A floor beneath the numeric constraint above: at least one real word (or
 * number) the family typed must appear, whole, in a candidate's name — or
 * nothing in the catalogue actually answers what was typed. A bare number, an
 * emoji-only line, or a fictitious item ("rare frozen cactus juice from space")
 * must resolve to nothing, never to whatever real product a fuzzy search or a
 * store's own free-text fallback happened to rank first.
 */
export function sharesWordWithQuery(query: string, name: string): boolean {
  // Below three characters a "word" is usually a particle ("לא", "עם", "של") that
  // would make "לא קיים" ("does not exist") match anything containing the word
  // "not" — the same length floor apps/mobile/src/lib/stores.ts's PICK_BY_NAME_JS
  // already applies to a store's own name-matching, for the same reason.
  const words = (s: string): string[] =>
    s
      .replace(/["'׳״]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3);
  const queryWords = words(query);
  if (queryWords.length === 0) return false;
  const nameWords = new Set(words(name));
  return queryWords.some((w) => nameWords.has(w));
}

const TO_MIDDLE: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const middleForm = (w: string): string => w.replace(/[ךםןףץ]/g, (ch) => TO_MIDDLE[ch]!);
const hebrewWords = (s: string): string[] =>
  s.replace(/["'׳״]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).map(middleForm);

/**
 * The singular a Hebrew plural on a list stands for: "מלפפונים" → "מלפפונ", "בננות" → "בננ",
 * "עגבניות" → "עגבני". Undefined for a word that is not a plural, or so short that taking the ending
 * off would leave a particle ("מים" is water, not a plural of "מ"). Final letters are compared in
 * their middle form, so "מלפפונימ" (the final mem typed as a middle one) is the same plural.
 */
export function pluralStem(word: string): string | undefined {
  const w = middleForm(word);
  if (w.length < 5 || !/^[א-ת]+$/.test(w)) return undefined;
  return /(ימ|ות)$/.test(w) ? w.slice(0, -2) : undefined;
}

/** A name word as the singular it is: "בננה" → "בננ", "מלפפון" → "מלפפונ", "פיתה" → "פית". */
const singularForms = (w: string): string[] => (/[הת]$/.test(w) && w.length >= 4 ? [w, w.slice(0, -1)] : [w]);

/**
 * The floor above, for a family that writes the plural and a catalogue that names the singular
 * (ops/chaos.mjs and the week's own list: "מלפפונים" against "מלפפון", "בננות" against "בננה",
 * "תפוחים" against "תפוח עץ" — no whole word in common, so every one of them was unresolved). Only a
 * plural query word is ever stemmed; "חלב" never matches "חלבה" (halva) this way.
 */
export function sharesStemWithQuery(query: string, name: string): boolean {
  const stems = hebrewWords(query).map(pluralStem).filter((s): s is string => s !== undefined);
  if (stems.length === 0) return false;
  const nameForms = new Set(hebrewWords(name).flatMap(singularForms));
  return stems.some((s) => nameForms.has(s));
}

/**
 * Words a name may carry beyond the item itself without being a different item: sizes, units,
 * packaging. Everything else a candidate adds ("בחומץ", "צ'יפס", "אדמה") makes it a more specific
 * thing than the family wrote.
 */
const PLAIN = new Set(['גרם', 'גר', 'ליטר', 'מל', 'קג', 'קילו', 'יח', 'יחידות', 'ארוז', 'ארוזה', 'מארז', 'שקית', 'משקל', 'במשקל', 'תפזורת', 'אורגני', 'אורגנית', 'טרי', 'טריה', 'מובחר', 'מובחרת', 'ישראל'].map(middleForm));

/**
 * How many words a candidate's name adds to what was typed, sizes and packaging aside. "מלפפונים"
 * against "מלפפון" is 0, against "מלפפון בחומץ 7-9" (pickles) 1: the plain one is what was meant.
 */
export function extraWords(query: string, name: string): number {
  const q = hebrewWords(query);
  const qForms = new Set([...q, ...q.map(pluralStem).filter((s): s is string => s !== undefined)]);
  return hebrewWords(name).filter((w) => /\p{L}/u.test(w) && !PLAIN.has(w) && !singularForms(w).some((f) => qForms.has(f))).length;
}

/**
 * Two words that are one different food: "תפוח אדמה" is a potato, not an apple. A plural matched
 * through its singular ("תפוחים" → "תפוח") never matches a name where the singular heads such a
 * compound the family did not write.
 */
const COMPOUND_TAILS = new Set(['אדמה']);
export function headsOtherCompound(query: string, name: string): boolean {
  const q = new Set(hebrewWords(query));
  const stems = new Set(hebrewWords(query).map(pluralStem).filter((s): s is string => s !== undefined));
  const n = hebrewWords(name);
  return n.some((w, i) => i + 1 < n.length && singularForms(w).some((f) => stems.has(f)) && COMPOUND_TAILS.has(n[i + 1]!) && !q.has(n[i + 1]!));
}
