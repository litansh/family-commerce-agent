import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedTotal, etaRank, etaTone, exceptionsOf, exceptionsOfStore, isComplete, opensAt, rowsFor, savingOf } from '../src/lib/compare.ts';

/**
 * The rules of docs/design/compare-accuracy.md, pinned.
 *
 * `e2e/compare-accuracy.mjs` runs these same functions over a real compare, which is the proof that
 * matters — but a real compare only contains what the stores happen to offer that morning. A split,
 * the case that put another store's product under a store's name, appeared in none of the captures;
 * so the split lives here, built from a real one (2026-09-13: Rami Levy ₪134.89 complete, Shufersal
 * ₪173.10 for 7 of 8 with ₪13.90 to complete, four Wolt venues shut until tomorrow morning).
 */
const q = {
  lines: [
    { id: 'a', query: 'חלב 3%' }, { id: 'b', query: 'ביצים L' }, { id: 'c', query: 'לחם אחיד פרוס' },
    { id: 'd', query: 'קוטג׳ 5%' }, { id: 'e', query: 'פילה סלמון' }, { id: 'f', query: 'בננות' },
    { id: 'g', query: 'שמן זית' }, { id: 'h', query: 'טופו' },
  ],
  quotedLines: { a: { productName: 'חלב יטבתה 3% בקבוק 2 ליטר' } },
  storefrontLines: {
    'rami-levy-online': {
      a: { productName: 'חלב יטבתה 3% בקבוק 2 ליטר' }, b: { productName: 'ביצים 30 יח M פיקוח' },
      c: { productName: 'לחם אחיד פרוס 750 גרם' }, d: { productName: "קוטג' תנובה 5% 250 ג'" },
      e: { productName: 'פילה סלמון במיץ טבעי 170 גרם' }, f: { productName: 'בננות' },
      // A swap Rami Levy made — on a line the split below buys at Shufersal, not here.
      g: { productName: 'שמן זית מזוכך אופיר 750מ"ל', substituted: true, reason: 'שמן זית → שמן זית מזוכך אופיר 750מ"ל' },
      h: { productName: 'טופו אורגני 350 גרם' },
    },
    'shufersal-online': {
      a: { productName: 'חלב 3% שקית 1 ליטר' }, b: { productName: 'ביצים אומגה L 30' },
      c: { productName: 'לחם אחיד פרוס אנג׳ל 900 גרם' }, d: { productName: "קוטג' תנובה 5% 250 ג'" },
      f: { productName: 'בננות אורגני' }, g: { productName: 'שמן זית כתית מעולה 750 מ"ל' },
      h: { productName: 'טופו טבעי 300 גרם' },
    },
  },
  etas: {
    'rami-levy-online': { kind: 'slots' as const },
    'shufersal-online': { kind: 'slots' as const },
    'wolt-victory-allenby': { kind: 'closed' as const, nextOpen: '2026-09-14T07:00', text: 'נפתח ביום מחר בשעה 07:00' },
    'wolt-machsanei-hashuk-ramat-gan': { kind: 'closed' as const, nextOpen: '2026-09-14T08:00' },
    'wolt-open-venue': { kind: 'live' as const, minutes: 35 },
  },
  options: [] as never[],
  rejected: [] as never[],
};

const leg = (storefrontId: string, brand: string, lineIds: string[], itemsSubtotal: number, deliveryFee: number) => ({ storefrontId, brand, lineIds, itemsSubtotal, deliveryFee });
const expl = (reason: string, savingVsBaseline = 0, baselineLabel = '') => ({ reason, savingVsBaseline, baselineLabel });

const ramiLevy = {
  kind: 'single_delivered', label: 'רמי לוי אונליין',
  legs: [leg('rami-levy-online', 'רמי לוי אונליין', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 9899, 3590)],
  cashCost: 13489, timeCost: 0, unpricedLineIds: [], missingEstimate: 0,
  expl: undefined, explanation: expl('Cheapest complete basket from one retailer', 0, 'רמי לוי אונליין'),
};
const shufersal = {
  kind: 'single_delivered', label: 'שופרסל ONLINE',
  legs: [leg('shufersal-online', 'שופרסל ONLINE', ['a', 'b', 'c', 'd', 'f', 'g', 'h'], 13720, 3590)],
  cashCost: 17310, timeCost: 0, unpricedLineIds: ['e'], missingEstimate: 1390,
  explanation: expl('Single retailer with verified delivery terms', -3821, 'רמי לוי אונליין'),
};
/** The case no real capture contained: two legs, and a swap sitting on the leg that does not buy that line. */
const split = {
  kind: 'split_delivered', label: 'רמי לוי + שופרסל',
  legs: [leg('rami-levy-online', 'רמי לוי אונליין', ['a', 'b', 'c', 'd'], 5000, 3590), leg('shufersal-online', 'שופרסל ONLINE', ['e', 'f', 'g', 'h'], 4000, 3590)],
  cashCost: 16180, timeCost: 0, unpricedLineIds: [], missingEstimate: 0,
  explanation: expl('4 lines are cheaper at שופרסל ONLINE, and the saving clears a second delivery fee'),
};

test('a shut store says it is shut and never ranks with an open one', () => {
  assert.equal(etaTone(q.etas['wolt-victory-allenby']), 'warn');
  assert.equal(etaTone(q.etas['rami-levy-online']), 'neutral');
  assert.equal(etaTone(q.etas['wolt-open-venue']), 'good');
  // The bug this replaces: a closed venue fell through to the window branch and read "משלוח בחלון",
  // at the same rank as a chain that will deliver today.
  assert.ok(etaRank(q.etas['wolt-victory-allenby']) > etaRank(q.etas['rami-levy-online']));
  assert.ok(etaRank(q.etas['wolt-victory-allenby']) > etaRank(q.etas['wolt-open-venue']));
  assert.equal(opensAt(q.etas['wolt-machsanei-hashuk-ramat-gan']), '08:00');
  assert.equal(opensAt(q.etas['rami-levy-online']), null);
});

test('a split names a swap only on the leg that buys that line', () => {
  const ex = exceptionsOf({ ...q, options: [split] } as never, split as never);
  assert.deepEqual(ex.missingLineIds, []);
  // "שמן זית" is swapped at Rami Levy, but this split buys שמן זית at Shufersal: naming that swap
  // would be a substitution the family's basket never makes.
  assert.deepEqual(ex.swaps, []);
  // The same swap on an option that does buy that line at Rami Levy is named.
  const whole = exceptionsOf({ ...q, options: [ramiLevy] } as never, ramiLevy as never);
  assert.deepEqual(whole.swaps.map((s) => s.lineId), ['g']);
  assert.equal(whole.swaps[0]!.storefrontId, 'rami-levy-online');
});

test('a split row calls nothing it buys missing, and unfolds to both legs', () => {
  const rows = rowsFor({ ...q, options: [ramiLevy, split] } as never, ramiLevy as never);
  const row = rows.find((r) => r.option === (split as never))!;
  assert.deepEqual(row.missingLineIds, []);
  // The bug this replaces: the row read legs[0] only, so the four lines Shufersal buys were called
  // missing and Rami Levy's products were shown under them.
  assert.deepEqual(row.brands.map((b) => b.brand), ['רמי לוי אונליין', 'שופרסל ONLINE']);
  assert.deepEqual(row.brands[1]!.lineIds, ['e', 'f', 'g', 'h']);
});

test('an incomplete option carries its completed total, and the difference is computed on it', () => {
  assert.equal(completedTotal(shufersal as never), 18700);
  assert.equal(completedTotal(ramiLevy as never), 13489);
  assert.equal(isComplete(shufersal as never), false);
  const rows = rowsFor({ ...q, options: [ramiLevy, shufersal] } as never, ramiLevy as never);
  const row = rows[0]!;
  assert.equal(row.price, 17310);
  assert.equal(row.completed, 18700);
  assert.equal(row.approx, true);
  // ₪52.11, on two completed baskets — not ₪38.21, which sets 7 lines against 8 (promise 4).
  assert.equal(row.moreThanAnswer, 5211);
  assert.deepEqual(row.missingLineIds, ['e']);
});

test('the answer names its saving even when the optimizer made it its own baseline', () => {
  // savingVsBaseline is 0 and baselineLabel is the winner itself, which is why the card used to show
  // a reason with no money in it.
  assert.equal(ramiLevy.explanation.savingVsBaseline, 0);
  const approx = savingOf({ ...q, options: [ramiLevy, shufersal] } as never, ramiLevy as never)!;
  assert.equal(approx.minor, 5211);
  assert.equal(approx.brand, 'שופרסל ONLINE');
  assert.equal(approx.approx, true, 'the yardstick had to be completed with an estimate');
  // A complete alternative is preferred, and then the figure is exact.
  const exact = savingOf({ ...q, options: [ramiLevy, split, shufersal] } as never, ramiLevy as never)!;
  assert.equal(exact.minor, 16180 - 13489);
  assert.equal(exact.brand, 'רמי לוי אונליין + שופרסל ONLINE');
  assert.equal(exact.approx, false);
  // Nothing else to buy this list from is the only case with no figure.
  assert.equal(savingOf({ ...q, options: [ramiLevy] } as never, ramiLevy as never), null);
});

test('a rejected store is items only, and says for how many lines', () => {
  const rejected = { storefrontId: 'carrefour-online', brand: 'קרפור אונליין', reason: 'basket is below the storefront minimum', code: 'minimum' as const, itemsSubtotal: 15428, pricedLines: 8, requestedLines: 8, minimumOrder: 20000, amountToMinimum: 4572 };
  const rows = rowsFor({ ...q, options: [ramiLevy], rejected: [rejected] } as never, ramiLevy as never);
  const row = rows.find((r) => r.storefrontId === 'carrefour-online')!;
  assert.equal(row.price, 15428);
  assert.equal(row.deliveredTotal, false, 'items only: no delivery fee is known for a rejected store, and none is invented');
  assert.equal(row.pricedLines, 8);
  assert.equal(row.shortOfMinimum, 4572);
  assert.equal(row.moreThanAnswer, undefined, 'an items-only number is never differenced against a delivered one');
});

test('a rejected store names the lines it lacks rather than counting them', () => {
  const ex = exceptionsOfStore(q as never, 'shufersal-online');
  assert.deepEqual(ex.missingLineIds, ['e']);
  assert.deepEqual(exceptionsOfStore(q as never, 'rami-levy-online').missingLineIds, []);
});

test('options sort by what the family would really pay, so a partial basket never jumps a full one', () => {
  const cheapPartial = { ...shufersal, cashCost: 12000, missingEstimate: 4000, unpricedLineIds: ['e'] };
  const rows = rowsFor({ ...q, options: [ramiLevy, cheapPartial, split] } as never, ramiLevy as never);
  // ₪120 looks cheapest, but completing it costs ₪160 — the split at ₪161.80 is not far behind, and
  // ordering on the partial number alone would put a 7-line basket above two 8-line ones.
  assert.deepEqual(rows.map((r) => r.completed ?? r.price), [16000, 16180]);
});
