import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestBasketFor, pickCheaper } from '../src/cheaper.ts';
import type { StorefrontQuote, QuotedLine, ListLine, ProductCandidate } from '@fca/domain';

const line = (id: string, name: string, price: number, over: Partial<QuotedLine> = {}): QuotedLine => ({ lineId: id, query: name, productName: name, gtin: `g-${id}`, qty: 1, unitPrice: price as never, lineTotal: price as never, substituted: false, clubOnly: false, resolutionSource: 'provider', ...over });
const quote = (id: string, lines: QuotedLine[], requested: number): StorefrontQuote => { const sub = lines.reduce((a, l) => a + l.lineTotal, 0); return { storefrontId: id, brand: id, chainId: id, serviceType: 'delivery', itemsSubtotal: sub as never, deliveryFee: 2000 as never, deliveredTotal: (sub + 2000) as never, meetsMinimum: true, requestedLines: requested, pricedLines: lines.length, lines, deliveryTermsConfidence: 'verified', priceFeedStale: false }; };
const cand = (gtin: string, name: string, price: number, over: Partial<ProductCandidate> = {}): ProductCandidate => ({ productId: gtin, gtin, name, fromPrice: price as never, pricedAtChains: 3, ...over });
const lines: ListLine[] = [{ id: 'a', query: 'קוטג\' תנובה 5% 250 גרם' }, { id: 'b', query: 'חלב 3% 1 ליטר' }] as ListLine[];

test('pickCheaper: a cheaper product of the same kind and size wins; a different size never does', () => {
  const current = cand('g-a', 'קוטג\' תנובה 5% 250 גרם', 690);
  const cheaperSameSize = cand('g-alt', 'קוטג\' טרה 5% 250 גרם', 550);
  const cheaperOtherSize = cand('g-big', 'קוטג\' טרה 5% 500 גרם', 500);
  const dearer = cand('g-dear', 'קוטג\' יטבתה 5% 250 גרם', 750);
  assert.equal(pickCheaper(current, [current, cheaperSameSize, cheaperOtherSize, dearer])?.gtin, 'g-alt');
});

test('pickCheaper: nothing wins when nothing is actually cheaper', () => {
  const current = cand('g-a', 'חלב תנובה 3% 1 ליטר', 800);
  const dearer = cand('g-b', 'חלב יטבתה 3% 1 ליטר', 850);
  assert.equal(pickCheaper(current, [current, dearer]), undefined);
});

test('cheapestBasketFor: a real, confirmed saving at this store is applied; the catalogue price alone is not enough', async () => {
  const store = quote('rl', [line('a', 'קוטג\' תנובה', 690), line('b', 'חלב תנובה', 800)], 2);
  const catalog = {
    searchProducts: async ({ query }: { query: string }) => {
      if (query.startsWith('קוטג')) return [cand('g-a', 'קוטג\' תנובה', 690), cand('g-alt', 'קוטג\' טרה', 550)];
      return [cand('g-b', 'חלב תנובה', 800), cand('g-alt2', 'חלב טרה', 700)];
    },
  } as never;
  // The re-quote at the real store only confirms the milk's saving; the cottage cheese's catalogue
  // price turns out not to hold at this store (its real price ties the original) - no swap for it.
  const qp = { quoteBasket: async () => ({ quotes: [quote('rl', [line('a', 'קוטג\' טרה', 690, { gtin: 'g-alt' }), line('b', 'חלב טרה', 700, { gtin: 'g-alt2' })], 2)], assumptions: [] }) } as never;
  const out = await cheapestBasketFor(qp, catalog, store, lines, 'x');
  assert.equal(out.total, 690 + 800);
  assert.equal(out.swaps.length, 1);
  assert.deepEqual(out.swaps[0], { lineId: 'b', gtin: 'g-alt2', productName: 'חלב טרה', lineTotal: 700, wasLineTotal: 800 });
  assert.equal(out.cheaperTotal, 690 + 700);
});

test('cheapestBasketFor: a line this store already substituted is never swapped again', async () => {
  const store = quote('rl', [line('a', 'קוטג\' תנובה', 690, { substituted: true })], 1);
  let searched = false;
  const catalog = { searchProducts: async () => { searched = true; return []; } } as never;
  const qp = { quoteBasket: async () => ({ quotes: [], assumptions: [] }) } as never;
  const out = await cheapestBasketFor(qp, catalog, store, lines, 'x');
  assert.equal(searched, false);
  assert.equal(out.swaps.length, 0);
  assert.equal(out.cheaperTotal, out.total);
});
