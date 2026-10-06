import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hebStem, pickSubstitute, sameWord, substituteMissing } from '../src/substitutes.ts';
import type { StorefrontQuote, QuotedLine, ListLine } from '@fca/domain';

const line = (id: string, name: string, price: number, over: Partial<QuotedLine> = {}): QuotedLine => ({ lineId: id, query: name, productName: name, qty: 1, unitPrice: price as never, lineTotal: price as never, substituted: false, clubOnly: false, resolutionSource: 'provider', ...over });
const quote = (id: string, lines: QuotedLine[], requested: number): StorefrontQuote => { const sub = lines.reduce((a, l) => a + l.lineTotal, 0); return { storefrontId: id, brand: id, chainId: id, serviceType: 'delivery', itemsSubtotal: sub as never, deliveryFee: 2000 as never, deliveredTotal: (sub + 2000) as never, meetsMinimum: true, requestedLines: requested, pricedLines: lines.length, lines, deliveryTermsConfidence: 'verified', priceFeedStale: false }; };
const lines: ListLine[] = [{ id: 'a', query: 'חלב' }, { id: 'b', query: 'לחם' }, { id: 'c', query: 'סלמון' }] as ListLine[];

test('a store missing the salmon gets the closest salmon it does carry, flagged and named; a store without any stays without', async () => {
  const shufersal = quote('shufersal', [line('a', 'חלב', 800), line('b', 'לחם', 900), line('c', 'סלמון טרי', 6000)], 3);
  const rami = quote('rami-levy', [line('a', 'חלב', 500), line('b', 'לחם', 600)], 3);
  const catalog = { searchProducts: async () => [{ productId: 'p1', gtin: '7290000000001', name: 'פילה סלמון נורבגי', pricedAtChains: 3 }] } as never;
  // Candidates now come back under their own ids ("c~0"), because each store answers for whichever
  // of several alternatives it actually carries.
  const qp = { quoteBasket: async () => ({ quotes: [quote('rami-levy', [line('c~0', 'פילה סלמון נורבגי', 5500, { gtin: '7290000000001' })], 1), quote('shufersal', [], 0)], assumptions: [] }) } as never;
  const out = await substituteMissing(qp, catalog, { quotes: [shufersal, rami], assumptions: [] } as never, lines, 'x');
  const r = out.quotes.find((q) => q.storefrontId === 'rami-levy')!;
  assert.equal(r.pricedLines, 3);
  assert.equal(r.itemsSubtotal, 500 + 600 + 5500);
  const sub = r.lines.find((l) => l.lineId === 'c')!;
  assert.equal(sub.substituted, true);
  assert.equal(sub.substitutionReason, 'סלמון → פילה סלמון נורבגי');
  assert.equal(out.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 3);
});

test('nothing missing means no extra quote', async () => {
  let calls = 0;
  const qp = { quoteBasket: async () => { calls++; return { quotes: [], assumptions: [] }; } } as never;
  const catalog = { searchProducts: async () => [] } as never;
  const full = quote('s', [line('a', 'חלב', 1), line('b', 'לחם', 1), line('c', 'סלמון', 1)], 3);
  await substituteMissing(qp, catalog, { quotes: [full], assumptions: [] } as never, lines, 'x');
  assert.equal(calls, 0);
});

// Coverage is a fact, never a gate (docs/design/a-full-basket-everywhere.md): a store missing
// almost everything still gets a full-basket try, not a silent skip for being too empty.
test('a store missing almost everything still gets a full-basket try, not a coverage floor', async () => {
  const thin = quote('t', [line('a', 'חלב', 500)], 3); // 1 of 3 — no partial-coverage floor stops it now
  const catalog = { searchProducts: async () => [{ productId: 'p1', gtin: '7290000000001', name: 'פילה סלמון נורבגי', pricedAtChains: 3 }, { productId: 'p2', gtin: '7290000000002', name: 'לחם אחיד', pricedAtChains: 3 }] } as never;
  const qp = { quoteBasket: async () => ({ quotes: [quote('t', [line('b~0', 'לחם אחיד', 700, { gtin: '7290000000002' }), line('c~0', 'פילה סלמון נורבגי', 5500, { gtin: '7290000000001' })], 2)], assumptions: [] }) } as never;
  const out = await substituteMissing(qp, catalog, { quotes: [thin], assumptions: [] } as never, lines, 'x');
  const r = out.quotes.find((q) => q.storefrontId === 't')!;
  assert.equal(r.pricedLines, 3);
  assert.ok(r.lines.every((l) => l.lineId !== 'a' || !l.substituted));
});

test('a substitute is the same kind of product: no pickles for cucumbers, no smoked for fresh salmon, no can for fresh tomatoes', () => {
  const c = (name: string, chains = 2) => ({ gtin: name, name, pricedAtChains: chains });
  assert.equal(pickSubstitute('מלפפונים', [c('מלפפונים בחומץ קטנים'), c('מלפפונים במלח'), c('מלפפונים ישראלי ארוז', 1)])?.name, 'מלפפונים ישראלי ארוז');
  assert.equal(pickSubstitute('פילה סלמון', [c('פילה סלמון מעושן 200 גרם', 3), c('פילה סלמון נורבגי טרי 500 גרם', 1)])?.name, 'פילה סלמון נורבגי טרי 500 גרם');
  assert.equal(pickSubstitute('עגבניות', [c('עגבניות חתוכות דק פריניר'), c('רסק עגבניות'), c('עגבניות שרי מארז', 2)])?.name, 'עגבניות שרי מארז');
  // Asked for smoked: smoked is fine. Nothing of the same kind: nothing.
  assert.equal(pickSubstitute('סלמון מעושן', [c('פילה סלמון מעושן 200 גרם')])?.name, 'פילה סלמון מעושן 200 גרם');
  assert.equal(pickSubstitute('ביצים L', [c('ביצים 12 יח גדול L', 0)]), undefined);
});

test('plural and singular are the same word: tomatoes ~ a packed tomato, cucumbers ~ a packed cucumber', () => {
  // The masculine plural ends in a final ם; the stem must lose it after the final letter is normalised.
  assert.equal(hebStem('ביצים'), 'ביצ');
  assert.equal(hebStem('מלפפונים'), hebStem('מלפפון'));
  assert.ok(sameWord('עגבניות', 'עגבניה'));
  assert.ok(sameWord('מלפפונים', 'מלפפון'));
  assert.ok(sameWord('ביצים', 'ביצה'));
  assert.ok(!sameWord('חלב', 'לחם'));
  const c = (name: string, chains = 2) => ({ gtin: name, name, pricedAtChains: chains });
  assert.equal(pickSubstitute('עגבניות', [c('עגבניה ארוזה 4 יחידות'), c('רסק עגבניות')])?.name, 'עגבניה ארוזה 4 יחידות');
});

test('stores with different assortments each fill the line with what they carry', async () => {
  // The owner, 13 September: "חלקי זה רק אם אין בכלל מוצרים קשורים". One global pick left every store
  // that happened not to stock it with an empty line, and the card called itself partial although the
  // store plainly has eggs. Several candidates go out; each store answers for the one it has.
  const a = quote('a', [line('a', 'חלב', 500)], 3);
  const b = quote('b', [line('a', 'חלב', 520)], 3);
  const catalog = { searchProducts: async () => [
    { productId: 'p1', gtin: '111', name: 'ביצים L ארוזות', pricedAtChains: 3 },
    { productId: 'p2', gtin: '222', name: 'ביצים XL אורגניות', pricedAtChains: 2 },
  ] } as never;
  // Store a carries only the first candidate, store b only the second.
  const qp = { quoteBasket: async () => ({ quotes: [
    quote('a', [line('b~0', 'ביצים L ארוזות', 1400, { gtin: '111' })], 1),
    quote('b', [line('b~1', 'ביצים XL אורגניות', 1900, { gtin: '222' })], 1),
  ], assumptions: [] }) } as never;
  const asked = [{ id: 'a', query: 'חלב', qty: 1 }, { id: 'b', query: 'ביצים', qty: 1 }];
  const out = await substituteMissing(qp, catalog, { quotes: [a, b], assumptions: [] } as never, asked as never, 'x');
  for (const sid of ['a', 'b']) {
    const q = out.quotes.find((x) => x.storefrontId === sid)!;
    assert.equal(q.pricedLines, 2, `${sid} should have filled the eggs with what it carries`);
    assert.equal(q.lines.find((l) => l.lineId === 'b')?.substituted, true);
  }
  // Each got its own product, at its own price.
  assert.equal(out.quotes.find((x) => x.storefrontId === 'a')!.lines.find((l) => l.lineId === 'b')?.lineTotal, 1400);
  assert.equal(out.quotes.find((x) => x.storefrontId === 'b')!.lines.find((l) => l.lineId === 'b')?.lineTotal, 1900);
});
