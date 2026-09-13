import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shekels, type Agorot } from '../src/money.ts';
import { cheapestExactElsewhere, storefrontFacts, isRealAlternative, wrongProductLineIds } from '../src/full-basket.ts';
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

const quote = (id: string, brand: string, lines: QuotedLine[], fee: number, requested: number, over: Partial<StorefrontQuote> = {}): StorefrontQuote => {
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
    ...over,
  };
};

test('state 1 — nothing pinned was swapped: one number, no second price', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 10), line('l1', 20)], 5, 2);
  const r = storefrontFacts(q, ['l0', 'l1'], new Set(), new Map());
  assert.equal(r.fullBasket.total, q.deliveredTotal);
  assert.equal(r.fullBasket.items, q.itemsSubtotal);
  assert.deepEqual(r.fullBasket.unfillableLineIds, []);
  assert.equal(r.exactBasket, undefined);
});

test('a free-text substitution never produces a second price — only a pinned line can', () => {
  // l0 is free text, swapped by the gap-filler; l1 was never pinned either, though priced exactly.
  const q = quote('rl', 'רמי לוי', [line('l0', 8, { substituted: true, substitutionReason: 'תפוחים → תפוחי עץ פינק' }), line('l1', 5)], 5, 2);
  const r = storefrontFacts(q, ['l0', 'l1'], new Set(), new Map([['l0', { lineId: 'l0', storefrontId: 'other', brand: 'אחר', lineTotal: shekels(9) }]]));
  assert.equal(r.exactBasket, undefined);
});

test('state 2 — a pinned line swapped: the exact basket appears, and the two totals differ by exactly the swap', () => {
  // l0 is pinned (a barcode the family confirmed) and this store substituted it.
  const q = quote('rl', 'רמי לוי', [line('l0', 5.5, { substituted: true, substitutionReason: "קוטג' תנובה → קוטג' טרה 5%" })], 5, 1);
  const elsewhere = new Map([['l0', { lineId: 'l0', storefrontId: 'shufersal', brand: 'שופרסל', lineTotal: shekels(6.9) }]]);
  const r = storefrontFacts(q, ['l0'], new Set(['l0']), elsewhere);
  assert.equal(r.fullBasket.total, q.deliveredTotal);
  assert.ok(r.exactBasket);
  assert.equal(r.exactBasket!.total - r.fullBasket.total, shekels(6.9) - shekels(5.5));
  assert.deepEqual(r.exactBasket!.elsewhere, [{ lineId: 'l0', storefrontId: 'shufersal', brand: 'שופרסל', lineTotal: shekels(6.9) }]);
});

test('state 5 — nobody nearby has the pinned product: no exact-basket line at all', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 14.9, { substituted: true, substitutionReason: 'שמן זית → שמן זית מזוכך אופיר' })], 5, 1);
  const r = storefrontFacts(q, ['l0'], new Set(['l0']), new Map()); // no store prices it unsubstituted
  assert.equal(r.exactBasket, undefined);
});

test('a swap cheaper than the pinned product costs less exactly, not more', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 5.5, { substituted: true })], 5, 1);
  const elsewhere = new Map([['l0', { lineId: 'l0', storefrontId: 'sh', brand: 'שופרסל', lineTotal: shekels(4) }]]);
  const r = storefrontFacts(q, ['l0'], new Set(['l0']), elsewhere);
  assert.ok(r.exactBasket!.total < r.fullBasket.total);
});

test('state 10 — delivery fee not known yet: deliveryFee is omitted, never guessed', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 10)], 5, 1, { deliveryTermsConfidence: 'unknown' });
  const r = storefrontFacts(q, ['l0'], new Set(), new Map());
  assert.equal(r.deliveryFee, undefined);
  assert.equal(r.fullBasket.items, q.itemsSubtotal);
});

test('a line nobody has, even substituted, is the only honest gap', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 8)], 5, 2);
  const r = storefrontFacts(q, ['l0', 'l1'], new Set(), new Map());
  assert.deepEqual(r.fullBasket.unfillableLineIds, ['l1']);
});

test('cheapestExactElsewhere ignores substituted lines and takes the cheapest real one, and where', () => {
  const a = quote('a', 'א', [line('l0', 10)], 0, 1);
  const b = quote('b', 'ב', [line('l0', 7)], 0, 1);
  const c = quote('c', 'ג', [line('l0', 3, { substituted: true })], 0, 1);
  const cheapest = cheapestExactElsewhere([a, b, c]);
  assert.deepEqual(cheapest.get('l0'), { lineId: 'l0', storefrontId: 'b', brand: 'ב', lineTotal: shekels(7) });
});

test('a substitution that is not really an alternative does not fill its line', () => {
  // Production, 13 September: the provider answered "אבקת כביסה" with "אל אמ קליק קפסולה חפיסה".
  assert.equal(isRealAlternative('אבקת כביסה', 'אל אמ קליק קפסולה חפיסה'), false);
  // A real alternative keeps the noun and changes the rest; plurals and final letters must not hide it.
  assert.equal(isRealAlternative("קוטג' תנובה 5%", "קוטג' טרה 5% 250 גרם"), true);
  assert.equal(isRealAlternative('ביצים XL 12', 'ביצה L ארוזה 12'), true);
  assert.equal(isRealAlternative('', 'anything'), true);

  // And it leaves the line unfillable rather than pricing the wrong product into a full basket.
  const q = quote('v', 'ויקטורי', [line('l0', 24, { productName: 'אל אמ קליק קפסולה חפיסה', substituted: true })], 5, 1);
  const facts = storefrontFacts(q, ['l0'], new Set(), new Map(), new Map([['l0', 'אבקת כביסה']]));
  assert.deepEqual(facts.fullBasket.unfillableLineIds, ['l0'], 'the wrong product does not count as filled');
});

test('a wrong product is caught even when nobody flagged it as a substitution', () => {
  // Production, 13 September, wolt-victory-tel-aviv-ahad-haam: "אבקת כביסה" came back as
  // "אל אמ קליק קפסולה חפיסה" with `substituted` unset, so the card would have shown a capsule pack
  // as though it were the laundry powder asked for. A flag we do not control cannot decide this.
  const q = quote('v', 'ויקטורי', [line('l0', 24, { productName: 'אל אמ קליק קפסולה חפיסה' })], 5, 1);
  const wrong = wrongProductLineIds(q, new Map([['l0', 'אבקת כביסה']]));
  assert.ok(wrong.has('l0'), 'judged on the product, not on a flag');
  const facts = storefrontFacts(q, ['l0'], new Set(), new Map(), new Map([['l0', 'אבקת כביסה']]));
  assert.deepEqual(facts.fullBasket.unfillableLineIds, ['l0']);
  // And a store that really does have it keeps it, flag or no flag.
  const ok = quote('r', 'רמי לוי', [line('l0', 22, { productName: 'אבקת כביסה סנו מקסימה' })], 5, 1);
  assert.equal(wrongProductLineIds(ok, new Map([['l0', 'אבקת כביסה']])).size, 0);
});
