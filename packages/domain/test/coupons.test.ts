import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoupons } from '../src/coupons.ts';
import { shekels } from '../src/money.ts';
import type { QuotedLine, StorefrontQuote } from '../src/types.ts';

const line = (id: string, gtin: string, name: string, unit: number, qty = 1): QuotedLine => ({
  lineId: id, query: name, productName: name, gtin, qty, unitPrice: shekels(unit), lineTotal: shekels(unit * qty),
  substituted: false, clubOnly: false, resolutionSource: 'gtin',
});
const quote: StorefrontQuote = {
  storefrontId: 'shufersal-online', brand: 'שופרסל', chainId: '7290027600007', serviceType: 'delivery',
  itemsSubtotal: shekels(100), deliveryFee: shekels(35.9), deliveredTotal: shekels(135.9), meetsMinimum: true,
  requestedLines: 2, pricedLines: 2, lines: [line('milk', '7290000042015', 'חלב תנובה', 7, 2), line('pampers', '8006530264464', 'פמפרס 4', 43)],
  deliveryTermsConfidence: 'verified', priceFeedStale: false,
};

test('a personal coupon lowers the delivered total by exactly its value', () => {
  const q = applyCoupons(quote, [{ id: 'c1', retailer: 'shufersal', gtin: '8006530264464', title: '₪10 הנחה על פמפרס', amountOff: shekels(10) }]);
  assert.equal(q.couponSavings, shekels(10));
  assert.equal(q.deliveredTotal, shekels(125.9));
  assert.equal(q.coupons[0]?.lineId, 'pampers');
});

test('a percent coupon is computed on the line, never on the basket', () => {
  const q = applyCoupons(quote, [{ id: 'c2', retailer: 'shufersal', gtin: '7290000042015', title: '20% על חלב', percentOff: 20 }]);
  assert.equal(q.couponSavings, shekels(2.8)); // 20% of 14.00
});

test('ignores coupons for another retailer, expired ones, and ones needing more units', () => {
  const q = applyCoupons(quote, [
    { id: 'x1', retailer: 'rami-levy', gtin: '8006530264464', title: 'wrong chain', amountOff: shekels(10) },
    { id: 'x2', retailer: 'shufersal', gtin: '8006530264464', title: 'expired', amountOff: shekels(10), expiresAt: '2000-01-01' },
    { id: 'x3', retailer: 'shufersal', gtin: '8006530264464', title: 'needs 3', amountOff: shekels(10), minQty: 3 },
  ]);
  assert.equal(q.couponSavings, 0);
  assert.equal(q.deliveredTotal, quote.deliveredTotal);
});

test('each coupon applies once and never exceeds the line', () => {
  const q = applyCoupons(quote, [{ id: 'big', retailer: 'shufersal', gtin: '7290000042015', title: 'huge', amountOff: shekels(999) }]);
  assert.equal(q.couponSavings, shekels(14), 'capped at the line total');
});

test('matches by name fragment when the retailer gives no barcode', () => {
  const q = applyCoupons(quote, [{ id: 'n', retailer: 'shufersal', nameMatch: 'פמפרס', title: 'פמפרס −₪5', amountOff: shekels(5) }]);
  assert.equal(q.couponSavings, shekels(5));
});
