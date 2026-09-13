import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shekels, type Agorot } from '../src/money.ts';
import { cheapestExactPricePerLine, fullBasketFor } from '../src/full-basket.ts';
import type { QuotedLine, StorefrontQuote } from '../src/types.ts';

const line = (id: string, total: number, over: Partial<QuotedLine> = {}): QuotedLine => ({
  lineId: id,
  query: id,
  productName: id,
  qty: 1,
  unitPrice: shekels(total),
  lineTotal: shekels(total),
  substituted: false,
  clubOnly: false,
  resolutionSource: 'provider',
  ...over,
});

const quote = (id: string, brand: string, lines: QuotedLine[], fee: number, requested: number): StorefrontQuote => {
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0) as Agorot;
  return {
    storefrontId: id,
    brand,
    chainId: id,
    serviceType: 'delivery',
    itemsSubtotal: subtotal,
    deliveryFee: shekels(fee),
    deliveredTotal: (subtotal + shekels(fee)) as Agorot,
    meetsMinimum: true,
    requestedLines: requested,
    pricedLines: lines.length,
    lines,
    deliveryTermsConfidence: 'verified',
    priceFeedStale: false,
  };
};

test('a store with no swaps: exact basket equals full basket', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 10), line('l1', 20)], 5, 2);
  const r = fullBasketFor(q, ['l0', 'l1'], new Map([['l0', 'חלב'], ['l1', 'לחם']]), new Map());
  assert.equal(r.fullBasketTotal, q.deliveredTotal);
  assert.equal(r.exactBasketTotal, r.fullBasketTotal);
  assert.equal(r.swaps.length, 0);
  assert.deepEqual(r.unresolvedLineIds, []);
});

test('the two totals differ by exactly the sum of the swaps, cheaper and dearer', () => {
  // l0 asked for cottage 6.90 elsewhere (the exact price); this store swaps it in at 5.50 (cheaper here).
  // l1 asked for apples 9.90 elsewhere; this store swaps it in at 11.20 (dearer here).
  const q = quote('rl', 'רמי לוי', [
    line('l0', 5.5, { substituted: true, substitutionReason: 'קוטג\' תנובה → קוטג\' טרה 5%' }),
    line('l1', 11.2, { substituted: true, substitutionReason: 'תפוחים → תפוחי עץ פינק' }),
  ], 5, 2);
  const exactPrices = new Map([['l0', shekels(6.9)], ['l1', shekels(9.9)]]);
  const r = fullBasketFor(q, ['l0', 'l1'], new Map([['l0', 'קוטג\' תנובה'], ['l1', 'תפוחים']]), exactPrices);
  assert.equal(r.fullBasketTotal, q.deliveredTotal);
  const sumOfSwaps = shekels(6.9 - 5.5) + shekels(9.9 - 11.2);
  assert.equal(r.exactBasketTotal - r.fullBasketTotal, sumOfSwaps);
  assert.equal(r.swaps.length, 2);
  assert.equal(r.swaps[0]?.reason, 'קוטג\' תנובה → קוטג\' טרה 5%');
});

test('a swap with no exact price anywhere costs no more, honestly, not an invented number', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 8, { substituted: true, substitutionReason: 'טופו → סייטן' })], 5, 1);
  const r = fullBasketFor(q, ['l0'], new Map([['l0', 'טופו']]), new Map());
  assert.equal(r.swaps[0]?.exactPrice, r.swaps[0]?.swapPrice);
  assert.equal(r.exactBasketTotal, r.fullBasketTotal);
});

test('a line nobody has, even substituted, is the only honest gap', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 8)], 5, 2);
  const r = fullBasketFor(q, ['l0', 'l1'], new Map([['l0', 'לחם'], ['l1', 'משהו נדיר']]), new Map());
  assert.deepEqual(r.unresolvedLineIds, ['l1']);
});

test('cheapestExactPricePerLine ignores substituted lines and takes the cheapest real one', () => {
  const a = quote('a', 'א', [line('l0', 10)], 0, 1);
  const b = quote('b', 'ב', [line('l0', 7)], 0, 1);
  const c = quote('c', 'ג', [line('l0', 3, { substituted: true })], 0, 1);
  const cheapest = cheapestExactPricePerLine([a, b, c]);
  assert.equal(cheapest.get('l0'), shekels(7));
});
