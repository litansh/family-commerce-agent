import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuoteParts } from '../src/supermcp.ts';
import type { QuoteResponse, StorefrontQuote } from '@fca/domain';

const q = (over: Partial<StorefrontQuote>): StorefrontQuote => ({
  storefrontId: 'rami', brand: 'רמי לוי', chainId: 'rami', serviceType: 'delivery',
  itemsSubtotal: 10000 as never, deliveryFee: 2900 as never, deliveredTotal: 12900 as never,
  meetsMinimum: true, requestedLines: 50, pricedLines: 50, lines: [], deliveryTermsConfidence: 'verified', priceFeedStale: false,
  ...over,
} as StorefrontQuote);
const part = (quotes: StorefrontQuote[]): QuoteResponse => ({ quotes, assumptions: [] } as unknown as QuoteResponse);

test('a basket split in two is one basket again: money summed, delivery counted once', () => {
  const merged = mergeQuoteParts([
    part([q({ itemsSubtotal: 10000 as never, pricedLines: 50, requestedLines: 50 })]),
    part([q({ itemsSubtotal: 4000 as never, deliveredTotal: 6900 as never, pricedLines: 12, requestedLines: 15 })]),
  ]);
  const one = merged.quotes[0]!;
  assert.equal(one.itemsSubtotal, 14000);
  assert.equal(one.deliveryFee, 2900);
  assert.equal(one.deliveredTotal, 16900);
  assert.equal(one.requestedLines, 65);
  assert.equal(one.pricedLines, 62);
});

test('a store that only the second half reached is kept, and a minimum is judged on the whole basket', () => {
  const merged = mergeQuoteParts([
    part([q({ itemsSubtotal: 3000 as never, minimumOrder: 12000 as never, meetsMinimum: false })]),
    part([q({ itemsSubtotal: 9500 as never, minimumOrder: 12000 as never, meetsMinimum: false }), q({ storefrontId: 'wolt', brand: 'וולט' })]),
  ]);
  const rami = merged.quotes.find((x) => x.storefrontId === 'rami')!;
  assert.equal(rami.itemsSubtotal, 12500);
  assert.equal(rami.meetsMinimum, true, 'twelve thousand five hundred clears a twelve thousand minimum');
  assert.ok(merged.quotes.some((x) => x.storefrontId === 'wolt'));
});

test('one part is returned untouched', () => {
  const only = part([q({})]);
  assert.equal(mergeQuoteParts([only]), only);
});
