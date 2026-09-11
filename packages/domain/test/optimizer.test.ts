import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shekels, type Agorot } from '../src/money.ts';
import { optimize, SUSPICIOUS_PRICE_RATIO } from '../src/optimizer.ts';
import { DEFAULT_CONSTANTS, type QuotedLine, type StorefrontQuote } from '../src/types.ts';

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

const quote = (
  id: string,
  brand: string,
  lines: QuotedLine[],
  fee: number,
  requested: number,
  over: Partial<StorefrontQuote> = {},
): StorefrontQuote => {
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

// ---------------------------------------------------------------------------

test('picks the cheapest complete single basket', () => {
  const ramiLevy = quote('rl', 'רמי לוי', [line('l0', 800.3)], 35.9, 1);
  const shufersal = quote('sh', 'שופרסל', [line('l0', 1047.3)], 35.9, 1);
  const { options } = optimize({
    quotes: [shufersal, ramiLevy],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ids(1),
  });
  assert.equal(options[0]?.label, 'רמי לוי');
  assert.equal(options[0]?.cashCost, shekels(836.2)); // the measured figure
});

test('rejects a cheap but incomplete storefront — coverage is a gate, not a display field', () => {
  // The Wolt trap: lowest total in the raw ranking, prices 10 of 36 lines.
  // It is not cheap, it is empty, and offering it causes the top-up trip.
  const wolt = quote('wolt', 'מחסני השוק (וולט)', ids(10).map((i) => line(i, 47)), 10, 36);
  const ramiLevy = quote('rl', 'רמי לוי', ids(36).map((i) => line(i, 22.23)), 35.9, 36);

  const { options, rejected } = optimize({
    quotes: [wolt, ramiLevy],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ids(36),
  });

  assert.equal(options.length, 1, 'the incomplete storefront must not be offered at all');
  assert.equal(options[0]?.label, 'רמי לוי');
  assert.match(rejected[0]?.reason ?? '', /prices only 10\/36 lines \(28%\)/);
});

test('splits to a second store when the saving clears the extra delivery fee', () => {
  const anchor = quote('rl', 'רמי לוי', [line('a', 400), line('b', 400)], 35.9, 2);
  const rival = quote('vic', 'ויקטורי', [line('a', 500), line('b', 281)], 35.9, 2);

  const { options } = optimize({
    quotes: [anchor, rival],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['a', 'b'],
  });

  const split = options.find((o) => o.kind === 'split_delivered');
  assert.ok(split, 'expected a split option');
  // The baseline is the cheapest COMPLETE single basket, which is ויקטורי at
  // 500 + 281 + 35.90 = 816.90 — not רמי לוי at 835.90.
  assert.equal(split.explanation.baselineLabel, 'ויקטורי');
  // Cheapest line from each: 400 at רמי לוי + 281 at ויקטורי + two 35.90 fees.
  assert.equal(split.cashCost, shekels(752.8));
  assert.equal(split.explanation.savingVsBaseline, shekels(64.1));
  assert.equal(split.legs.length, 2);
});

test('does not split when the saving fails to clear the household threshold', () => {
  // 10 shekels of item saving against a 35.90 second fee: never worth it.
  const anchor = quote('rl', 'רמי לוי', [line('a', 400), line('b', 400)], 35.9, 2);
  const rival = quote('vic', 'ויקטורי', [line('a', 500), line('b', 390)], 35.9, 2);

  const { options } = optimize({
    quotes: [anchor, rival],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['a', 'b'],
  });
  assert.equal(options.find((o) => o.kind === 'split_delivered'), undefined);
});

test('never splits past the household store cap', () => {
  const { options } = optimize({
    quotes: [
      quote('a', 'A', [line('x', 300), line('y', 300), line('z', 300)], 35.9, 3),
      quote('b', 'B', [line('x', 100), line('y', 300), line('z', 300)], 35.9, 3),
      quote('c', 'C', [line('x', 300), line('y', 100), line('z', 300)], 35.9, 3),
    ],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['x', 'y', 'z'],
  });
  for (const o of options) {
    assert.ok(o.legs.length <= DEFAULT_CONSTANTS.maxStores, `${o.label} used ${o.legs.length} stores`);
  }
});

test('will not build a split leg that falls under a storefront minimum', () => {
  const anchor = quote('rl', 'רמי לוי', [line('a', 400), line('b', 400)], 35.9, 2);
  const rival = quote('hh', 'חצי חינם', [line('a', 500), line('b', 100)], 35.9, 2, {
    minimumOrder: shekels(500), // the moved leg would only be 100
  });
  const { options } = optimize({
    quotes: [anchor, rival],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['a', 'b'],
  });
  assert.equal(options.find((o) => o.kind === 'split_delivered'), undefined);
});

test('flags an implausible cross-chain price gap as a resolution error', () => {
  // "בננה" matching banana-flavoured protein powder at one chain.
  const cheap = quote('rl', 'רמי לוי', [line('banana', 12)], 35.9, 1);
  const wrong = quote('sh', 'שופרסל', [line('banana', 89)], 35.9, 1);
  const { warnings } = optimize({
    quotes: [cheap, wrong],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['banana'],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /not a bargain/);
  assert.ok(89 / 12 >= SUSPICIOUS_PRICE_RATIO);
});

test('cash cost and time cost are never merged', () => {
  const branch = quote('rl-branch', 'רמי לוי גבעתיים', [line('a', 700)], 0, 1);
  const { options } = optimize({
    quotes: [quote('rl', 'רמי לוי', [line('a', 800.3)], 35.9, 1)],
    constants: { ...DEFAULT_CONSTANTS, valueOfTimePerHour: shekels(80), minSavingToDrive: shekels(40) },
    requestedLineIds: ['a'],
    driveOptions: [
      {
        quote: branch,
        travel: { distanceKm: 6, roundTripMinutes: 35, fuelCost: shekels(15), parkingCost: shekels(0) },
      },
    ],
  });
  const drive = options.find((o) => o.kind === 'drive');
  assert.ok(drive);
  assert.equal(drive.cashCost, shekels(715), 'cash is items plus fuel and parking only');
  assert.equal(drive.timeCost, shekels(46.67), '35 min at 80/hr, reported separately');
  assert.notEqual(drive.cashCost, drive.cashCost + drive.timeCost);
});

test('a household that does not price its time gets a zero time cost, not an invented one', () => {
  const branch = quote('rl-branch', 'רמי לוי גבעתיים', [line('a', 700)], 0, 1);
  const { options } = optimize({
    quotes: [quote('rl', 'רמי לוי', [line('a', 800.3)], 35.9, 1)],
    constants: { ...DEFAULT_CONSTANTS, minSavingToDrive: shekels(40) },
    requestedLineIds: ['a'],
    driveOptions: [
      {
        quote: branch,
        travel: { distanceKm: 6, roundTripMinutes: 35, fuelCost: shekels(15), parkingCost: shekels(0) },
      },
    ],
  });
  assert.equal(options.find((o) => o.kind === 'drive')?.timeCost, 0);
});

test('rejects a storefront below its own minimum', () => {
  const { options, rejected } = optimize({
    quotes: [quote('hh', 'חצי חינם', [line('a', 100)], 35.9, 1, { meetsMinimum: false })],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['a'],
  });
  assert.equal(options.length, 0);
  assert.match(rejected[0]?.reason ?? '', /minimum/);
});

test('reports unpriced lines so the family can see what is missing', () => {
  const q = quote('rl', 'רמי לוי', [line('l0', 10), line('l1', 10)], 35.9, 2);
  const { options } = optimize({
    quotes: [q],
    constants: { ...DEFAULT_CONSTANTS, minCoverageRatio: 0.5 },
    requestedLineIds: ['l0', 'l1', 'l2'],
  });
  assert.deepEqual(options[0]?.unpricedLineIds, ['l2']);
});

test('is a pure function — same input, same output', () => {
  const input = {
    quotes: [
      quote('rl', 'רמי לוי', [line('a', 400), line('b', 400)], 35.9, 2),
      quote('vic', 'ויקטורי', [line('a', 500), line('b', 281)], 35.9, 2),
    ],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ['a', 'b'],
  };
  assert.deepEqual(optimize(input), optimize(input));
});

test('no eligible storefront yields no options rather than a bad one', () => {
  const { options } = optimize({
    quotes: [quote('w', 'Wolt', [line('l0', 47)], 10, 36)],
    constants: DEFAULT_CONSTANTS,
    requestedLineIds: ids(36),
  });
  assert.deepEqual(options, []);
});

test('a storefront missing a line still serves as the second leg of a split: the anchor keeps what it lacks', () => {
  const full = quote('shufersal', 'Shufersal', [line('milk', 8), line('bread', 9), line('salmon', 60), line('eggs', 14), line('rice', 12)], 30, 5);
  // Rami Levy has no salmon (4 of 5 lines) but is much cheaper on the rest.
  const partial = quote('rami-levy', 'Rami Levy', [line('milk', 2), line('bread', 2), line('eggs', 4), line('rice', 3)], 20, 5);
  const r = optimize({ quotes: [full, partial], constants: { ...DEFAULT_CONSTANTS, minSavingForSecondStore: shekels(5) }, requestedLineIds: ids(0).concat(['milk', 'bread', 'salmon', 'eggs', 'rice']) });
  const split = r.options.find((o) => o.kind === 'split_delivered');
  assert.ok(split, 'a split is offered');
  const rl = split!.legs.find((l) => l.storefrontId === 'rami-levy')!;
  const sh = split!.legs.find((l) => l.storefrontId === 'shufersal')!;
  assert.deepEqual([...rl.lineIds].sort(), ['bread', 'eggs', 'milk', 'rice']);
  assert.deepEqual(sh.lineIds, ['salmon']);
  // On its own, the partial store is still rejected for coverage.
  assert.ok(r.rejected.some((x) => x.storefrontId === 'rami-levy' && x.code === 'coverage'));
});
