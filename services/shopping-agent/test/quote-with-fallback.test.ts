import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirm, emptyMemory, shekels, type ListLine, type QuotedLine, type StorefrontQuote } from '@fca/domain';
import type { QuoteProvider, QuoteRequest, QuoteResponse } from '@fca/retailer-connectors';
import { CONFIRMED_UNAVAILABLE, quoteWithFallback } from '../src/index.ts';

const ql = (lineId: string, total: number): QuotedLine => ({
  lineId, query: lineId, productName: `product-${lineId}`, qty: 1,
  unitPrice: shekels(total), lineTotal: shekels(total),
  substituted: false, clubOnly: false, resolutionSource: 'provider',
});
const sq = (id: string, lines: QuotedLine[], requested: number): StorefrontQuote => {
  const sub = lines.reduce((a, l) => a + l.lineTotal, 0);
  return {
    storefrontId: id, brand: id, chainId: id, serviceType: 'delivery',
    itemsSubtotal: shekels(sub / 100), deliveryFee: shekels(35.9), deliveredTotal: shekels(sub / 100 + 35.9),
    meetsMinimum: true, requestedLines: requested, pricedLines: lines.length, lines,
    deliveryTermsConfidence: 'verified', priceFeedStale: false,
  };
};

/** A provider that stocks the milk barcode only at Rami Levy. */
class FakeProvider implements QuoteProvider {
  readonly id = 'fake';
  readonly calls: QuoteRequest[] = [];
  async quoteBasket(req: QuoteRequest): Promise<QuoteResponse> {
    this.calls.push(req);
    const n = req.lines.length;
    const rl = req.lines.map((l) => ql(l.id, 10));
    const sh = req.lines.filter((l) => !(l.gtin === 'milk-gtin')).map((l) => ql(l.id, l.gtin ? 12 : 9));
    return { quotes: [sq('rami-levy', rl, n), sq('shufersal', sh, n)], assumptions: [], providerId: 'fake', latencyMs: 1, raw: null };
  }
}

const lines: ListLine[] = [
  { id: 'milk', query: 'חלב 3%', gtin: 'milk-gtin' },
  { id: 'bread', query: 'לחם' },
];

test('a storefront lacking the exact barcode gets the line by query, marked as a substitution', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk' });
  const res = await quoteWithFallback(p, { lines, address: 'x' }, memory);

  const sh = res.quotes.find((q) => q.storefrontId === 'shufersal')!;
  assert.equal(sh.pricedLines, 2, 'shufersal now prices both lines');
  const milk = sh.lines.find((l) => l.lineId === 'milk')!;
  assert.equal(milk.substituted, true);
  assert.equal(milk.substitutionReason, CONFIRMED_UNAVAILABLE);
  assert.equal(sh.itemsSubtotal, shekels(18), 'totals recomputed from the merged lines');
  assert.equal(sh.deliveredTotal, shekels(53.9));

  const rl = res.quotes.find((q) => q.storefrontId === 'rami-levy')!;
  assert.equal(rl.lines.find((l) => l.lineId === 'milk')?.substituted, false, 'rami levy had the barcode; untouched');
});

test('second pass asks by words only, for only the missing lines', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk' });
  await quoteWithFallback(p, { lines, address: 'x' }, memory);
  assert.equal(p.calls.length, 2);
  assert.deepEqual(p.calls[1]!.lines.map((l) => [l.id, l.gtin]), [['milk', undefined]]);
});

test('respects a household that said never substitute', async () => {
  const p = new FakeProvider();
  const memory = confirm(emptyMemory('h'), { phrase: 'חלב 3%', gtin: 'milk-gtin', productName: 'milk', substitution: 'never' });
  const res = await quoteWithFallback(p, { lines, address: 'x' }, memory);
  assert.equal(p.calls.length, 1, 'no second pass');
  assert.equal(res.quotes.find((q) => q.storefrontId === 'shufersal')!.pricedLines, 1, 'the line stays unpriced there');
});

test('no pinned lines means a single pass', async () => {
  const p = new FakeProvider();
  await quoteWithFallback(p, { lines: [{ id: 'bread', query: 'לחם' }], address: 'x' }, emptyMemory('h'));
  assert.equal(p.calls.length, 1);
});
