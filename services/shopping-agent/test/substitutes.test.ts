import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSubstitute, substituteMissing } from '../src/substitutes.ts';
import type { StorefrontQuote, QuotedLine, ListLine } from '@fca/domain';

const line = (id: string, name: string, price: number, over: Partial<QuotedLine> = {}): QuotedLine => ({ lineId: id, query: name, productName: name, qty: 1, unitPrice: price as never, lineTotal: price as never, substituted: false, clubOnly: false, resolutionSource: 'provider', ...over });
const quote = (id: string, lines: QuotedLine[], requested: number): StorefrontQuote => { const sub = lines.reduce((a, l) => a + l.lineTotal, 0); return { storefrontId: id, brand: id, chainId: id, serviceType: 'delivery', itemsSubtotal: sub as never, deliveryFee: 2000 as never, deliveredTotal: (sub + 2000) as never, meetsMinimum: true, requestedLines: requested, pricedLines: lines.length, lines, deliveryTermsConfidence: 'verified', priceFeedStale: false }; };
const lines: ListLine[] = [{ id: 'a', query: 'חלב' }, { id: 'b', query: 'לחם' }, { id: 'c', query: 'סלמון' }] as ListLine[];

test('a store missing the salmon gets the closest salmon it does carry, flagged and named; a store without any stays without', async () => {
  const shufersal = quote('shufersal', [line('a', 'חלב', 800), line('b', 'לחם', 900), line('c', 'סלמון טרי', 6000)], 3);
  const rami = quote('rami-levy', [line('a', 'חלב', 500), line('b', 'לחם', 600)], 3);
  const catalog = { searchProducts: async () => [{ productId: 'p1', gtin: '7290000000001', name: 'פילה סלמון נורבגי', pricedAtChains: 3 }] } as never;
  const qp = { quoteBasket: async () => ({ quotes: [quote('rami-levy', [line('c', 'פילה סלמון נורבגי', 5500, { gtin: '7290000000001' })], 1), quote('shufersal', [], 1)], assumptions: [] }) } as never;
  const out = await substituteMissing(qp, catalog, { quotes: [shufersal, rami], assumptions: [] } as never, lines, 'x');
  const r = out.quotes.find((q) => q.storefrontId === 'rami-levy')!;
  assert.equal(r.pricedLines, 3);
  assert.equal(r.itemsSubtotal, 500 + 600 + 5500);
  const sub = r.lines.find((l) => l.lineId === 'c')!;
  assert.equal(sub.substituted, true);
  assert.equal(sub.substitutionReason, 'סלמון → פילה סלמון נורבגי');
  assert.equal(out.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 3);
});

test('nothing missing, or too much missing, means no extra quote', async () => {
  let calls = 0;
  const qp = { quoteBasket: async () => { calls++; return { quotes: [], assumptions: [] }; } } as never;
  const catalog = { searchProducts: async () => [] } as never;
  const full = quote('s', [line('a', 'חלב', 1), line('b', 'לחם', 1), line('c', 'סלמון', 1)], 3);
  await substituteMissing(qp, catalog, { quotes: [full], assumptions: [] } as never, lines, 'x');
  const thin = quote('t', [line('a', 'חלב', 1)], 3); // 1 of 3 — below the partial-leg floor
  await substituteMissing(qp, catalog, { quotes: [thin], assumptions: [] } as never, lines, 'x');
  assert.equal(calls, 0);
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
