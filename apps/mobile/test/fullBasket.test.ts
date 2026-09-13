import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternativeTo, cardFor, cardsFor, headlineOf, whereExact, type BasketLike } from '../src/lib/fullBasket.ts';

/**
 * The states of `docs/design/a-full-basket-everywhere.md` that one real compare happens not to
 * contain. `e2e/full-basket.mjs` proves states 2, 4, 6, 7, 10 and 11 against the captured compare in
 * `e2e/lab/compare.json`; these are the other six, plus the rule the whole module exists to enforce —
 * that no total on a card was ever added up by the screen.
 */

const shekels = (n: number) => Math.round(n * 100);

/** A compare with two storefronts, as small as the rules allow. `lines` are the family's own words. */
function quote(over: Partial<BasketLike> = {}): BasketLike {
  return {
    lines: [{ id: 'a', query: 'חלב 3%' }, { id: 'b', query: 'שמן זית' }],
    options: [], rejected: [], quotedLines: {}, warnings: [], assumptions: [], suggestions: [], fromMemory: [],
    storefrontLines: {},
    ...over,
  } as unknown as BasketLike;
}

const leg = (sid: string, brand: string, items: number, fee: number, lineIds: string[]) => ({ storefrontId: sid, brand, itemsSubtotal: shekels(items), deliveryFee: shekels(fee), lineIds });
const option = (sid: string, brand: string, items: number, fee: number, lineIds: string[]) => ({
  kind: 'single_delivered', label: brand, legs: [leg(sid, brand, items, fee, lineIds)],
  cashCost: shekels(items + fee), timeCost: 0, unpricedLineIds: [], explanation: { reason: '', savingVsBaseline: 0, baselineLabel: '' },
});

// --- State 1: nothing the family pinned was swapped, so the card carries one number. ---
test('a store that gives the family exactly what they asked for shows one number', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    storefrontLines: { 'a-store': { a: { productName: 'חלב תנובה 3%', price: shekels(6.9) }, b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } },
  });
  const card = cardFor(q, 'a-store');
  assert.equal(card.complete, true);
  assert.deepEqual(card.swaps, []);
  assert.ok(card.states.includes('yours'));
  assert.equal(card.exact, undefined, 'no second basket when nothing was swapped');
  assert.equal(alternativeTo(card, headlineOf(card, null)), null, 'and so nothing beside the headline');
  assert.equal(card.full.total, shekels(135.9));
  assert.equal(card.full.delivered, true);
});

// --- State 5: the pinned product is at no store nearby. The only gap the design calls honest. ---
test('a pinned product no store carries is said so on every card, and offers no exact basket', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    rejected: [{ storefrontId: 'b-store', brand: 'ויקטורי', reason: '', code: 'minimum', itemsSubtotal: shekels(110), pricedLines: 2, requestedLines: 2, minimumOrder: shekels(250), amountToMinimum: shekels(140) }],
    storefrontLines: {
      'a-store': { a: { productName: 'חלב תנובה 3%', price: shekels(6.9) }, b: { productName: 'שמן זית אופיר', price: shekels(14.9), substituted: true, reason: 'שמן זית → שמן זית אופיר' } },
      'b-store': { a: { productName: 'חלב טרה 3%', price: shekels(7.4) }, b: { productName: 'שמן זית ויקטורי', price: shekels(27.9), substituted: true, reason: 'שמן זית → שמן זית ויקטורי' } },
    },
  });
  assert.deepEqual(whereExact(q, 'b'), [], 'nobody priced the pinned bottle itself');
  for (const sid of ['a-store', 'b-store']) {
    const card = cardFor(q, sid);
    assert.equal(card.swaps.length, 1);
    assert.equal(card.swaps[0]!.nowhere, true);
    assert.equal(card.swaps[0]!.elsewhere, undefined);
    assert.ok(card.states.includes('exact-nowhere'));
    assert.equal(card.exact, undefined, 'an unbuyable exact basket is never priced');
  }
});

// --- State 3: when the exact basket is the cheaper of the two, it leads the card. ---
test('the exact basket leads when it is the cheaper of the two', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    storefrontLines: { 'a-store': { a: { productName: 'חלב תנובה 3%', price: shekels(6.9) }, b: { productName: 'שמן זית יקר', price: shekels(39.9), substituted: true } } },
    storefronts: { 'a-store': { brand: 'רמי לוי', deliveryFee: shekels(35.9), exactBasket: { total: shekels(128.4) } } },
    // Another store has the bottle they pinned, so the exact basket is a thing they could buy.
    rejected: [],
  });
  q.storefrontLines!['b-store'] = { b: { productName: 'שמן זית אליעד', price: shekels(24.9) } };
  const card = cardFor(q, 'a-store');
  const head = headlineOf(card, null);
  assert.equal(head.mode, 'exact', 'nobody is made to pay for a stand-in they did not want');
  assert.ok(card.states.includes('exact-cheaper'));
  const alt = alternativeTo(card, head);
  // The card must name the alternative for what it *is*. When the exact basket leads, the second line
  // is the FULL basket — calling it "הסל המדויק שלך" there would print the headline's own name twice.
  assert.equal(alt?.basket.mode, 'full');
  assert.equal(alt?.diff, shekels(135.9) - shekels(128.4), 'the difference is stated in shekels');
  // And one tap shows the full basket instead, with the exact one named beside it.
  const swapped = headlineOf(card, 'full');
  assert.equal(swapped.mode, 'full');
  assert.equal(alternativeTo(card, swapped)?.basket.mode, 'exact');
});

// --- States 8 and 9: "עשה את זה זול יותר". ---
test('"make it cheaper" is a mode the card enters, and every swap it makes is named and undoable', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    storefrontLines: { 'a-store': { a: { productName: 'חלב יטבתה 3%', price: shekels(8.4) }, b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } },
    cheaper: { 'a-store': [{ lineId: 'a', productName: 'חלב תנובה 3% 2 ל׳', lineTotal: shekels(6.9), wasLineTotal: shekels(8.4) }] },
  });
  const card = cardFor(q, 'a-store');
  assert.ok(card.states.includes('cheapened'));
  assert.equal(card.swaps.length, 1);
  assert.equal(card.swaps[0]!.kind, 'cheaper', 'a swap the family chose is never the same kind as one they did not');
  assert.equal(card.swaps[0]!.saved, shekels(1.5));
  assert.equal(card.swaps[0]!.asked, 'חלב 3%');
  assert.equal(card.cheap?.total, shekels(135.9) - shekels(1.5));
  // The headline follows the tap, and one tap back restores the full basket.
  assert.equal(headlineOf(card, 'cheap').mode, 'cheap');
  assert.equal(headlineOf(card, null).mode, 'full');
  // The alternative beside the cheapened headline is the full basket, named as the full basket.
  const alt = alternativeTo(card, headlineOf(card, 'cheap'))!;
  assert.equal(alt.basket.mode, 'full');
  assert.equal(alt.diff, shekels(1.5), 'and the difference is what the tap saved');
});

test('a store where nothing cheaper was found says so once, and shows no cheaper basket', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    storefrontLines: { 'a-store': { a: { productName: 'חלב תנובה 3%', price: shekels(6.9) }, b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } },
    cheaper: { 'a-store': [] },
  });
  const card = cardFor(q, 'a-store');
  assert.ok(card.states.includes('cheaper-none'));
  assert.equal(card.cheap, undefined);
  assert.equal(headlineOf(card, 'cheap').mode, 'full', 'asking for cheaper when there is none changes nothing');
});

// --- The rule the module exists for: a total is the engine's, or there is no total. ---
test('the card never adds unit prices up, and says when its number is items only', () => {
  // The store's own subtotal is ₪98.99; the unit prices sum to ₪107.40, as they really do at Rami
  // Levy on the captured compare, because `price` is a shelf price and the subtotal carries promotions.
  const q = quote({
    rejected: [{ storefrontId: 'a-store', brand: 'קרפור', reason: '', code: 'minimum', itemsSubtotal: shekels(98.99), pricedLines: 2, requestedLines: 2, minimumOrder: shekels(200), amountToMinimum: shekels(101.01) }],
    storefrontLines: { 'a-store': { a: { productName: 'חלב', price: shekels(77.5) }, b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } },
  });
  const card = cardFor(q, 'a-store');
  assert.equal(card.full.items, shekels(98.99), "the engine's own number, not the sum");
  assert.notEqual(card.full.items, shekels(107.4));
  assert.equal(card.full.delivered, false, 'no fee is known, so this is not a delivered total');
  assert.ok(card.states.includes('fee-unknown'));
  assert.equal(card.shortOfMinimum, shekels(101.01));
  assert.ok(card.states.includes('under-minimum'), 'a minimum is a fact on the card, not a rejection');
});

test('a store the response priced but gave no subtotal for shows no total at all', () => {
  const q = quote({ storefrontLines: { 'a-store': { a: { productName: 'חלב', price: shekels(6.9) }, b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } } });
  const card = cardFor(q, 'a-store');
  assert.equal(card.full.total, undefined, 'the weaker true thing, never the stronger false one');
  assert.equal(card.full.items, undefined);
  assert.equal(card.complete, true, 'it can still fill the basket — that much is known');
});

// --- Coverage is a fact on a card, and the order never puts a partial basket above a full one. ---
test('every store gets a card, complete baskets first, then by what fills most of the list', () => {
  const q = quote({
    options: [option('mid', 'אמצע', 120, 35.9, ['a', 'b'])],
    rejected: [
      { storefrontId: 'cheap', brand: 'זול', reason: '', code: 'minimum', itemsSubtotal: shekels(90), pricedLines: 2, requestedLines: 2, minimumOrder: shekels(200), amountToMinimum: shekels(110) },
      { storefrontId: 'half', brand: 'חצי', reason: '', code: 'coverage', itemsSubtotal: shekels(10), pricedLines: 1, requestedLines: 2 },
    ],
    storefrontLines: {
      mid: { a: { productName: 'x', price: 1 }, b: { productName: 'y', price: 1 } },
      cheap: { a: { productName: 'x', price: 1 }, b: { productName: 'y', price: 1 } },
      half: { a: { productName: 'x', price: 1 } },
    },
  });
  const cards = cardsFor(q);
  assert.deepEqual(cards.map((c) => c.storefrontId), ['cheap', 'mid', 'half']);
  assert.equal(cards.at(-1)!.complete, false, 'a partial basket never jumps a full one');
  assert.deepEqual(cards.at(-1)!.unfillableLineIds, ['b'], 'and it names what it cannot fill');
  assert.ok(cards.at(-1)!.states.includes('cannot-fill'));
});

test('one basket leads the card, and the alternative beside it is never the same basket', () => {
  const q = quote({
    options: [option('a-store', 'רמי לוי', 100, 35.9, ['a', 'b'])],
    storefrontLines: { 'a-store': { a: { productName: 'חלב', price: shekels(6.9) }, b: { productName: 'שמן זית אופיר', price: shekels(14.9), substituted: true } }, 'b-store': { b: { productName: 'שמן זית אליעד', price: shekels(29.9) } } },
    storefronts: { 'a-store': { brand: 'רמי לוי', exactBasket: { total: shekels(151.4), elsewhere: [{ lineId: 'b', storefrontId: 'b-store', brand: 'שופרסל' }] } } },
  });
  const card = cardFor(q, 'a-store');
  const head = headlineOf(card, null);
  assert.equal(head.mode, 'full', 'the cheaper of the two leads');
  const alt = alternativeTo(card, head)!;
  assert.equal(alt.basket.mode, 'exact');
  assert.notEqual(alt.basket, head);
  assert.equal(alt.diff, shekels(151.4) - shekels(135.9));
  assert.equal(alt.basket.approx, true, 'a total that crosses a store boundary rests on an estimate');
  assert.ok(card.states.includes('approx'));
  assert.deepEqual(card.swaps[0]!.elsewhere, [{ storefrontId: 'b-store', brand: 'b-store' }]);
});
