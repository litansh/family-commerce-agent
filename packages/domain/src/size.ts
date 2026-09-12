/**
 * Pack sizes, the way a person reads them. "1000 ml" is "1 ליטר"; "12 unit" is "12 יח׳".
 * The catalogue gives (sizeQty, sizeUnit); a store's product name often carries the size
 * when the catalogue does not ("חלב תנובה 3% 1 ליטר"). Both end up in the same words, so a
 * family choosing between two milks sees the litre next to each.
 */
export function formatSize(qty: number | undefined, unit: string | undefined): string | undefined {
  if (!qty || !unit || !(qty > 0)) return undefined;
  const u = unit.toLowerCase();
  const n = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));
  if (u === 'ml' || u === 'מ"ל' || u === 'מל') return qty >= 1000 ? `${n(qty / 1000)} ליטר` : `${n(qty)} מ״ל`;
  if (u === 'l' || u === 'ליטר') return `${n(qty)} ליטר`;
  if (u === 'g' || u === 'גרם' || u === 'גר') return qty >= 1000 ? `${n(qty / 1000)} ק״ג` : `${n(qty)} גרם`;
  if (u === 'kg' || u === 'ק"ג' || u === 'קג' || u === 'קילוגרם') return `${n(qty)} ק״ג`;
  if (u === 'unit' || u === 'units' || u === 'piece' || u === 'pieces' || u === 'יח' || u === "יח'" || u === 'יחידות' || u === 'יחידה') return `${n(qty)} יח׳`;
  return `${n(qty)} ${unit}`;
}

// No \b here: JavaScript's word boundary does not know Hebrew letters. A unit ends where letters end.
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(ליטר|ל'|ל׳|מ"ל|מ״ל|מל|ק"ג|ק״ג|קג|גרם|גר'|גר|יחידות|יח'|יח׳|יח|kg|ml|g|l)(?![\p{L}])/iu;

/** The size a product name states, as a plain quantity and a normalised unit — for grouping, not display. */
export function parseSizeFromName(name: string): { qty: number; unit: string } | undefined {
  const m = SIZE_RE.exec(name.replace(/,/g, '.'));
  if (!m) return undefined;
  const qty = Number(m[1]); const u = m[2]!.toLowerCase();
  const unit = /^(ליטר|ל'|ל׳|l)$/.test(u) ? 'l' : /^(מ"ל|מ״ל|מל|ml)$/.test(u) ? 'ml' : /^(ק"ג|ק״ג|קג|kg)$/.test(u) ? 'kg' : /^(גרם|גר'|גר|g)$/.test(u) ? 'g' : 'unit';
  return { qty, unit };
}

/** The size a product name carries, when the catalogue has none: "1 ליטר", "250 גרם", "12 יח'", "1.5L", "500g". */
export function sizeFromName(name: string): string | undefined {
  const parsed = parseSizeFromName(name);
  return parsed ? formatSize(parsed.qty, parsed.unit) : undefined;
}

/** A name with its own size token removed, e.g. so what is left can be compared across packagings. */
export function stripSizeFromName(name: string): string {
  return name.replace(/,/g, '.').replace(SIZE_RE, ' ').replace(/\s+/g, ' ').trim();
}
