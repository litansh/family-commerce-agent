import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobBudget, SYNC_BUDGET, substituteShareMs, substitutesMs, tailMs } from '../src/compare-budget.ts';

// 2026-10-10: the week for five answered in 28.3 s, because the steps after the substitutes
// (barcodes, pictures, windows, in-store) ran one after another, each on a clock of its own.
test('on the sync route the steps after the substitutes end by 28 s, however late they start', () => {
  for (const elapsed of [5_000, 15_000, 20_000, 24_000, 26_000]) {
    assert.ok(elapsed + tailMs(SYNC_BUDGET, elapsed) <= 28_000, `started at ${elapsed} ms`);
  }
  // A compare that is already late still gets a second for what is cached, never zero.
  assert.equal(tailMs(SYNC_BUDGET, 27_500), 1_000);
  assert.equal(tailMs(SYNC_BUDGET, 40_000), 1_000);
});

test('the background job keeps minutes for each step', () => {
  assert.equal(tailMs(jobBudget(39), 100_000), 45_000);
  assert.equal(substituteShareMs(jobBudget(39)), 45_000);
  assert.equal(substituteShareMs(SYNC_BUDGET), 9_000);
});

// The whole sync clock: the quote's try ends by 26 s, the substitutes by 27 s, and the capped steps
// after them by 28 s, so a slow provider gives the ops checks a 'stores_slow' or an answer, never a
// gateway 503 at 30 s. Before 2026-10-10 the steps after the substitutes had 5 s + 4 s + Wolt's
// feed of their own, one after another: up to 38 s.
test('on the sync route the capped steps end by 28 s from the start, whenever the quote answers', () => {
  for (let quoteDone = 0; quoteDone <= SYNC_BUDGET.tryMs; quoteDone += 500) {
    const subsDone = quoteDone + substitutesMs(SYNC_BUDGET, quoteDone);
    assert.ok(subsDone <= 27_000, `quote at ${quoteDone}: substitutes until ${subsDone}`);
    assert.ok(subsDone + tailMs(SYNC_BUDGET, subsDone) <= 28_000, `quote at ${quoteDone}: tail until ${subsDone + tailMs(SYNC_BUDGET, subsDone)}`);
  }
  assert.equal(substitutesMs(SYNC_BUDGET, 10_000), 9_000, 'an early quote still gets the substitutes\' whole share');
});
