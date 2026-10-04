import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMOS_FULL_MS, PROMOS_THIN_MS, shouldRepullPromos } from '../src/deals-cache.ts';

const now = Date.parse('2026-10-04T04:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

test('no cache, or one without a time, is always pulled', () => {
  assert.equal(shouldRepullPromos(0, 0, undefined, now), true);
  assert.equal(shouldRepullPromos(40, 5, undefined, now), true);
  assert.equal(shouldRepullPromos(40, 5, 'not a date', now), true);
});

test("a one-chain cache is not pulled again on every visit (2026-10-04: the provider's feed was 200/200 Wolt Market and each /deals re-pulled and re-searched up to 120 names)", () => {
  assert.equal(shouldRepullPromos(200, 1, ago(60_000), now), false);
  assert.equal(shouldRepullPromos(200, 1, ago(PROMOS_THIN_MS + 1), now), true);
});

test('a full cache lives six hours', () => {
  assert.equal(shouldRepullPromos(200, 4, ago(PROMOS_THIN_MS + 1), now), false);
  assert.equal(shouldRepullPromos(200, 4, ago(PROMOS_FULL_MS + 1), now), true);
});
