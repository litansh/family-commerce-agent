import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productAt } from '../src/lib/quote.ts';

// A real compare for the test family (apps/mobile/e2e/split-naming.mjs, 2026-09-13): the shared
// resolution followed Rami Levy — a 2 ℓ bottle of יטבתה, M eggs, a 750 g loaf — while Shufersal
// priced and would deliver something else for the very same three lines.
const quote = {
  quotedLines: {
    a: { gtin: '7290004131074', productName: 'חלב יטבתה 3% מועשר בסידן ובויטמין D - בקבוק 2 ליטר', imageUrl: 'https://img.rami-levy.co.il/product/7290004131074/small.jpg' },
    b: { gtin: '7290000066318', productName: 'ביצים 30 יח`ארוזות M פיקוח' },
    c: { gtin: '7290000208114', productName: 'לחם אחיד פרוס 750 גרם' },
    d: { gtin: '7290004127152', productName: "קוטג' תנובה 5% שומן 250 ג' בד\"צ" },
  },
  storefrontLines: {
    'shufersal-online': {
      a: { gtin: '7290110115005', productName: 'חלב 3% שומן שקית 1 ליטר פיקוח', link: 'https://www.shufersal.co.il/online/he/p/P_7290110115005' },
      b: { gtin: '7290004102098', productName: 'ביצים אומגה L 30 יחידות' },
      c: { gtin: '7290000042909', productName: 'לחם אחיד פרוס אנג׳ל 900 גרם | מוצר בפיקוח' },
      d: { gtin: '7290004127152', productName: "קוטג' תנובה 5% שומן 250 ג' בד\"צ" },
    },
    // A store that priced the line without naming a barcode of its own.
    'victory-online': { a: { productName: 'חלב 3% שומן שקית 1 ליטר פיקוח' } },
  },
};

test('a store is named by what it will actually deliver, not by the compare-wide resolution', () => {
  const milk = productAt(quote, 'shufersal-online', 'a');
  assert.equal(milk.productName, 'חלב 3% שומן שקית 1 ליטר פיקוח');
  assert.equal(milk.gtin, '7290110115005');
  assert.equal(milk.link, 'https://www.shufersal.co.il/online/he/p/P_7290110115005');
  assert.equal(milk.own, true);
  // The size is the whole point: a 1 ℓ bag beside a 2 ℓ bottle is the commonest way a compare lies.
  assert.notEqual(milk.productName, quote.quotedLines.a.productName);
  assert.equal(productAt(quote, 'shufersal-online', 'b').productName, 'ביצים אומגה L 30 יחידות');
  assert.equal(productAt(quote, 'shufersal-online', 'c').productName, 'לחם אחיד פרוס אנג׳ל 900 גרם | מוצר בפיקוח');
});

test('the same product at two stores stays the same product', () => {
  assert.equal(productAt(quote, 'shufersal-online', 'd').productName, quote.quotedLines.d.productName);
  assert.equal(productAt(quote, 'shufersal-online', 'd').gtin, '7290004127152');
});

test('a store that named no barcode keeps its own name and borrows the compare\'s barcode', () => {
  const p = productAt(quote, 'victory-online', 'a');
  assert.equal(p.productName, 'חלב 3% שומן שקית 1 ליטר פיקוח');
  assert.equal(p.gtin, '7290004131074');
  assert.equal(p.own, true);
  assert.equal(p.link, undefined);
});

test('a store that did not price the line at all falls back to the compare, and says so', () => {
  const p = productAt(quote, 'victory-online', 'c');
  assert.equal(p.productName, 'לחם אחיד פרוס 750 גרם');
  assert.equal(p.own, false);
  // `own: false` is what lets a screen keep the shared photo; with a store's own product it must not.
  const q = productAt(quote, 'shufersal-online', 'a');
  assert.equal(q.gtin === quote.quotedLines.a.gtin, false);
});

test('an unknown store or line does not throw, it just names nothing', () => {
  assert.deepEqual(productAt(quote, 'no-such-store', 'zzz'), { own: false });
});
