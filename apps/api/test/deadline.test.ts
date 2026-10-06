import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeadlinePassed, isSlowError, withDeadline } from '../src/deadline.ts';

test('a promise that settles in time passes through', async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 50), 7);
});

test('a promise past its deadline rejects with DeadlinePassed', async () => {
  const slow = new Promise<number>((r) => setTimeout(() => r(1), 200));
  await assert.rejects(withDeadline(slow, 20), (e: unknown) => e instanceof DeadlinePassed);
});

test('the slow classifier: deadline, the MCP abort and a dropped socket are slow; anything else is not', () => {
  assert.equal(isSlowError(new DeadlinePassed(1)), true);
  const abort = new Error('This operation was aborted'); abort.name = 'AbortError';
  assert.equal(isSlowError(abort), true);
  assert.equal(isSlowError(new TypeError('fetch failed')), true);
  assert.equal(isSlowError(new Error('optimize_delivery: HTTP 500')), false);
  assert.equal(isSlowError(new Error('household not found')), false);
  assert.equal(isSlowError('string'), false);
});

test("the provider's 'Service is busy' (service_busy) is slow, so the compare tries again and the API answers 503 stores_slow, never 500", () => {
  assert.equal(isSlowError(new Error('optimize_delivery: Error: Service is busy. Please retry shortly. (code: service_busy)')), true);
  assert.equal(isSlowError(new Error('search_products: HTTP 429')), true);
});
