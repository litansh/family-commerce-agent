import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTally, nextItem, readCount, type PerItemTally } from '../src/lib/basket.ts';

// A family walking three items at a store that publishes its basket count. Readings arrive every
// couple of seconds while the item's own page is on screen.
const walk = (readings: [item: number, n: number | 'next'][]) => readings.reduce<PerItemTally>(
  (t, [item, n]) => (n === 'next' ? nextItem(t) : readCount(t, item, n)), emptyTally,
);

test('an item is claimed only when the store\'s own number rises on its page', () => {
  const t = walk([[0, 0], [0, 0], [0, 1]]);
  assert.deepEqual([...t.verified], [0]);
  assert.equal(t.baseline, 1);
});

test('the page the family never added from stays unclaimed', () => {
  const t = walk([[0, 2], [0, 2], [0, 'next'], [1, 2], [1, 2], [1, 'next'], [2, 2], [2, 3]]);
  assert.deepEqual([...t.verified], [2], 'only the third item went in');
});

test('a basket that already holds items does not verify the next one for free', () => {
  // The recipe put 6 in before falling back to the per-item pages: item 0 starts at 6, not at 0.
  const t = walk([[0, 6], [0, 6]]);
  assert.deepEqual([...t.verified], []);
  assert.equal(t.baseline, 6);
});

test('a store that answers "basket:?" claims nothing at all', () => {
  const t = walk([[0, Number.NaN], [0, Number.NaN]]);
  assert.equal(t.baseline, null);
  assert.deepEqual([...t.verified], []);
});

test('a count that falls — the family removed it again — never unclaims, and never claims', () => {
  const after = walk([[0, 1], [0, 2], [0, 1], [0, 1]]);
  assert.deepEqual([...after.verified], [0], 'the rise happened, and it was real');
  // ...and the fall cannot be read as a second add when the number climbs back.
  const back = readCount(after, 0, 2);
  assert.deepEqual([...back.verified], [0]);
});

test('two rises on one page claim that page once, not twice', () => {
  const t = walk([[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual([...t.verified], [0]);
});

test('moving on keeps every verdict so far and starts the next page blank', () => {
  const t = nextItem(walk([[0, 0], [0, 1]]));
  assert.deepEqual([...t.verified], [0]);
  assert.equal(t.baseline, null);
});
