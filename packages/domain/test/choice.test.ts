import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChoice } from '../src/choice.ts';
import { shekels } from '../src/money.ts';
import type { ProductCandidate } from '../src/types.ts';

const p = (
  id: string,
  brand: string | undefined,
  name: string,
  sizeQty: number,
  from: number,
  unit: number,
  chains = 3,
): ProductCandidate => ({
  productId: id,
  gtin: `gtin-${id}`,
  name,
  ...(brand !== undefined ? { brand, rawBrand: brand } : {}),
  sizeQty,
  sizeUnit: 'ml',
  fromPrice: shekels(from),
  unitPrice: shekels(unit),
  unitBasis: 'per_100ml',
  pricedAtChains: chains,
});

// Real values from a live search for "חלב 3%" in Ramat Gan.
const MILK = [
  p('tnuva-bag', 'תנובה', 'חלב 3% שומן שקית 1 ליטר', 1000, 6.41, 0.641),
  p('tnuva-carton', 'תנובה בע"מ', 'חלב תנובה מהדרין 3% 1 ליטר', 1000, 7.35, 0.735, 4),
  p('tara-carton', 'טרה', 'חלב הומוגני טרה 3% 1 ליטר', 1000, 7.35, 0.735),
  p('yotvata', 'מחלבת יטבתה', 'חלב בקבוק 3% יטבתה 1 ל', 1000, 7.35, 0.735),
];

test('honours the brand the family named', () => {
  const c = buildChoice(MILK, { lineId: 'l0', query: 'חלב 3%', requestedBrand: 'תנובה' });
  assert.ok(c);
  assert.equal(c.brandHonoured, true);
  assert.match(c.chosen.name, /תנובה|שקית/);
  assert.equal(c.chosen.brand, 'תנובה');
});

test('never silently swaps in a cheaper rival brand', () => {
  const withCheapRival = [...MILK, p('cheap', 'טרה', 'חלב טרה 3% זול', 1000, 4.9, 0.49)];
  const c = buildChoice(withCheapRival, {
    lineId: 'l0',
    query: 'חלב 3%',
    requestedBrand: 'תנובה',
  });
  assert.ok(c);
  assert.equal(c.chosen.brand, 'תנובה', 'the family asked for Tnuva and must get Tnuva');
  // …but the cheaper rival must still be offered.
  const rival = c.alternatives.find((a) => a.candidate.productId === 'cheap');
  assert.ok(rival, 'the cheaper rival must be offered as an alternative');
  assert.equal(rival.relation, 'other_brand');
  assert.ok((rival.percentDelta ?? 0) > 0, 'and be reported as cheaper');
});

test('ranks alternatives cheapest per unit first', () => {
  const c = buildChoice(MILK, { lineId: 'l0', query: 'חלב 3%' });
  assert.ok(c);
  const deltas = c.alternatives.map((a) => a.unitPriceDelta ?? 0);
  assert.deepEqual([...deltas].sort((x, y) => x - y), deltas);
});

test('offers one alternative per rival brand, not a catalogue dump', () => {
  const many = [
    ...MILK,
    p('tara-2', 'טרה', 'חלב טרה 3% קרטון 2 ליטר', 2000, 14.7, 0.735),
    p('tara-3', 'טרה', 'חלב טרה 3% שקית', 1000, 7.1, 0.71),
  ];
  const c = buildChoice(many, { lineId: 'l0', query: 'חלב 3%', requestedBrand: 'תנובה' });
  assert.ok(c);
  const taraCount = c.alternatives.filter((a) => a.candidate.brand?.includes('טרה')).length;
  assert.equal(taraCount, 1, 'one Tara option, not three');
});

test('compares on unit price, so a small pot never looks like a bargain', () => {
  // The real bug: "קוטג' 5%" resolved to a 100g pot at ₪3.20 (₪3.20/100g)
  // when the 250g tub at ₪7.10 is ₪2.84/100g — 11% better value.
  const pot = { ...p('pot', 'תנובה', 'קוטג׳ 100 גרם', 100, 3.2, 3.2, 3), sizeUnit: 'g', unitBasis: 'per_100g' };
  const tub = { ...p('tub', 'תנובה', 'קוטג׳ 250 גרם', 250, 7.1, 2.84, 3), sizeUnit: 'g', unitBasis: 'per_100g' };
  const c = buildChoice([pot, tub], { lineId: 'l0', query: "קוטג' 5%", requestedBrand: 'תנובה' });
  assert.ok(c);
  assert.equal(c.chosen.productId, 'tub', 'better value per 100g wins over lower sticker price');
});

test('does not chase the giant pack just because its unit price is lowest', () => {
  const normal = p('normal', 'תנובה', 'חלב 3% 1 ליטר', 1000, 7.35, 0.735, 5);
  const bulk = p('bulk', 'תנובה', 'חלב 3% 12 ליטר מארז', 12000, 66, 0.55, 1);
  const c = buildChoice([normal, bulk], { lineId: 'l0', query: 'חלב 3%' });
  assert.ok(c);
  assert.equal(c.chosen.productId, 'normal', 'a 12L case is not what a family means by "milk"');
});

test('says so plainly when the requested brand is unavailable', () => {
  // Müller is a real dairy brand that this search simply did not return.
  const c = buildChoice(MILK, { lineId: 'l0', query: 'חלב 3%', requestedBrand: 'מולר' });
  assert.ok(c);
  assert.equal(c.brandHonoured, false);
  assert.match(c.note ?? '', /No .* found/);
});

test('excludes products no chain actually prices', () => {
  // Real catalogue entries come back with fromPrice null and chains 0.
  const ghost = { ...p('ghost', 'תנובה', 'חלב 3% שאף אחד לא מוכר', 1000, 1, 0.1), pricedAtChains: 0 };
  const c = buildChoice([...MILK, ghost], { lineId: 'l0', query: 'חלב 3%' });
  assert.ok(c);
  assert.notEqual(c.chosen.productId, 'ghost');
  assert.equal(c.alternatives.some((a) => a.candidate.productId === 'ghost'), false);
});

test('returns nothing when nothing is buyable, rather than a fake choice', () => {
  const ghosts = MILK.map((m) => ({ ...m, pricedAtChains: 0 }));
  assert.equal(buildChoice(ghosts, { lineId: 'l0', query: 'חלב 3%' }), undefined);
});

test('a confirmed barcode wins over everything', () => {
  const c = buildChoice(MILK, {
    lineId: 'l0',
    query: 'חלב 3%',
    requestedGtin: 'gtin-tara-carton',
  });
  assert.ok(c);
  assert.equal(c.chosen.productId, 'tara-carton');
  assert.equal(c.source, 'gtin');
});

test('refuses to claim a percentage when unit prices are implausibly far apart', () => {
  // Real case: two Pampers packs, one reported per-pack and one per-nappy.
  const perPack = { ...p('pack', 'פמפרס', 'פמפרס מידה 4 29 יח', 29, 36.9, 36.9, 3), sizeUnit: 'unit', unitBasis: 'per_piece' };
  const perNappy = { ...p('nappy', 'האגיס', 'האגיס מידה 4 28 יח', 28, 38.9, 1.39, 3), sizeUnit: 'unit', unitBasis: 'per_piece' };
  const c = buildChoice([perPack, perNappy], { lineId: 'l0', query: 'חיתולים מידה 4', requestedBrand: 'פמפרס' });
  assert.ok(c);
  const alt = c.alternatives.find((a) => a.candidate.productId === 'nappy');
  assert.ok(alt);
  assert.equal(alt.percentDelta, undefined, 'a 26x gap is a broken basis, not a 96% saving');
  assert.match(alt.reason, /not comparable/);
});

test('a bare number never silently becomes an unrelated real product', () => {
  // Real bug: "12345" resolved to a nail polish sharing zero words with the query.
  const unrelated = [p('polish', 'דניה קוסמטיקס', 'לק קריסטל גלו 651 יח', 1, 20, 20, 3)];
  assert.equal(buildChoice(unrelated, { lineId: 'l0', query: '12345' }), undefined);
});

test('a query for something no store carries resolves to nothing, not to candy', () => {
  // Real bug: a fictitious "rare frozen cactus juice from space" resolved to sugar-free lemon candy.
  const unrelated = [p('candy', 'מורז', 'ויויל-סוכריות ללא סוכר טעם לימון', 1, 8, 8, 3)];
  assert.equal(buildChoice(unrelated, { lineId: 'l0', query: 'מיץ קקטוס קפוא נדיר מהחלל' }), undefined);
});

test('a query that does share a real word with the catalogue still resolves normally', () => {
  const c = buildChoice(MILK, { lineId: 'l0', query: 'חלב קר' }); // "cold milk" — no candidate names "קר", but all share "חלב"
  assert.ok(c);
  assert.match(c.chosen.name, /חלב/);
});

test('honours a size stated in the query over a better unit price', () => {
  const size1 = { ...p('s1', 'פמפרס', 'חיתולי פמפרס פרימיום מידה 1 44 יח', 44, 37.9, 0.86, 3), sizeUnit: 'unit', unitBasis: 'per_piece' };
  const size4 = { ...p('s4', 'פמפרס', 'חיתולי פמפרס בייבי דריי מידה 4 29 יח', 29, 36.9, 1.27, 3), sizeUnit: 'unit', unitBasis: 'per_piece' };
  const c = buildChoice([size1, size4], { lineId: 'l0', query: 'חיתולי פמפרס מידה 4', requestedBrand: 'פמפרס' });
  assert.ok(c);
  assert.equal(c.chosen.productId, 's4', 'the family asked for size 4; size 1 is not a bargain, it is the wrong product');
});

// Live provider answers for the chaotic list's words, Ramat Gan, 2026-10-11 (search_products, limit 16).
const veg = (id: string, name: string, chains = 1): ProductCandidate => ({ productId: id, gtin: `gtin-${id}`, name, pricedAtChains: chains });
const CUCUMBERS = [
  veg('c1', 'מלפפון'), veg('c2', 'מלפפון בחומץ 7-9 בית השיטה, 290 גרם', 2), veg('c3', 'מלפפון במלח 10-12 A2 בית השיטה 560 גר`', 3),
  veg('c4', 'מלפפון אורגני כ- 500 גרם'), veg('c5', 'מלפפון בייבי כ- 300 גרם'), veg('c6', 'מלפפון ארוז 6 יחידות'), veg('c7', 'מלפפונים', 0),
];

test('a plural on the list resolves to the plain singular the catalogue names (ops/chaos.mjs: "מלפפונים", "מלפפונימ")', () => {
  for (const query of ['מלפפונים', 'מלפפונימ']) {
    const c = buildChoice(CUCUMBERS, { lineId: 'x-typo', query });
    assert.ok(c, `${query} must not be a dead end: the catalogue names "מלפפון" at a chain`);
    assert.ok(['c1', 'c4', 'c6'].includes(c.chosen.productId), `${query} chose "${c.chosen.name}"; pickles or baby cucumbers are a different item`);
  }
});

test('bananas resolve to a banana, never to banana chips', () => {
  const c = buildChoice([veg('b1', 'בננה'), veg('b2', "בננה צ'יפס תפזורת"), veg('b3', 'בננה ציפס 200 גרם ששון הקולה'), veg('b4', 'בננה כ- 1 ק״ג')], { lineId: 'b27', query: 'בננות' });
  assert.ok(c);
  assert.ok(['b1', 'b4'].includes(c.chosen.productId), c.chosen.name);
});

test('"תפוחים" is apples: a potato ("תפוח אדמה") is never chosen for it', () => {
  const c = buildChoice([veg('p1', 'תפוח אדמה באטר כ -1.3 ק״ג', 2), veg('p2', 'תפוח אדמה לבן דוד משה', 2), veg('a1', 'תפוח עץ זהוב כ- 1 ק״ג')], { lineId: 'b28', query: 'תפוחים' });
  assert.ok(c);
  assert.equal(c.chosen.productId, 'a1');
  assert.equal(buildChoice([veg('p1', 'תפוח אדמה באטר כ -1.3 ק״ג', 2)], { lineId: 'b28', query: 'תפוחים' }), undefined, 'only potatoes: unresolved, not a potato');
});

test('the plural floor never opens a door for an unrelated product or a near-spelling', () => {
  assert.equal(buildChoice([veg('h', 'חלבה נוגט כשר חלבי משקל')], { lineId: 'm', query: 'חלב milk 3%' }), undefined, 'halva is not milk');
  assert.equal(buildChoice([veg('w', 'מים מינרליים עין גדי')], { lineId: 'w', query: 'מימ' }), undefined, 'too short to be a plural');
  assert.equal(buildChoice([veg('x', 'ויויל-סוכריות ללא סוכר טעם לימון')], { lineId: 'n', query: 'מיץ קקטוס קפוא נדיר מהחלל' }), undefined);
});
