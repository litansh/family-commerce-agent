import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobBudget, SYNC_BUDGET, substituteShareMs, tailMs, wordsPassMs } from '../src/compare-budget.ts';

// The 2026-10-10 health run: the chaotic list's compare was a 503 'stores_slow' because the words
// pass ran on with no time of its own until the whole try's 26 s deadline took the barcode pass's
// priced answer down with it. The words pass must end inside the try, with room to spare.
test('the words pass always ends before the try it runs in', () => {
  for (const b of [SYNC_BUDGET, jobBudget(8), jobBudget(39), jobBudget(60), jobBudget(10_000)]) {
    assert.ok(wordsPassMs(b) <= b.tryMs - 5_000, `${JSON.stringify(b)}: words pass ${wordsPassMs(b)} ms`);
    assert.ok(wordsPassMs(b) > 0);
  }
  // The week for five's words pass took 18.6 s from the ops Mac; the sync route still lets it land.
  assert.ok(wordsPassMs(SYNC_BUDGET) >= 19_000);
});

// The same morning: the week for five answered in 28.3 s, because the steps after the substitutes
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
