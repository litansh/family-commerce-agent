import { test } from 'node:test';
import assert from 'node:assert/strict';
// The rule as it ships (it used to be a copy here, because index.ts cannot be imported from a test):
// a basket the provider must be asked for in two calls gets more time than one it answers in one.
import { jobBudget } from '../src/compare-budget.ts';

test('a short list keeps a short budget, a long one gets room for its extra calls', () => {
  assert.deepEqual(jobBudget(8), { tryMs: 45_000, totalMs: 135_000 });
  // 60 lines is two provider calls a pass: the flat 110 s that failed a real list at 113 s is gone.
  assert.equal(jobBudget(60).totalMs, 180_000);
  assert.ok(jobBudget(60).totalMs > 113_000);
});

test('the budget is capped, so a pathological list cannot hold a Lambda open', () => {
  assert.equal(jobBudget(10_000).totalMs, 280_000);
  assert.equal(jobBudget(10_000).tryMs, 120_000);
});

test('an empty list is still one call\'s worth of budget', () => {
  assert.equal(jobBudget(0).tryMs, 45_000);
});
