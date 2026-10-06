import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, regionOf, REGIONS } from '../src/region.ts';

test('unknown or missing country falls back to the default region, never throws', () => {
  assert.equal(regionOf(undefined).country, 'IL');
  assert.equal(regionOf('ZZ').country, 'IL');
  assert.equal(regionOf('us').country, 'US', 'case-insensitive');
});

test('every region carries the four things the app needs', () => {
  for (const r of Object.values(REGIONS)) {
    assert.ok(r.currency && r.locale && typeof r.rtl === 'boolean' && r.distance, r.country);
  }
});

test('formats minor units per currency', () => {
  assert.equal(formatMoney(83620, 'ILS'), '₪836.20');
  assert.equal(formatMoney(1234, 'USD'), '$12.34');
  assert.equal(formatMoney(-6700, 'EUR'), '-€67.00');
  assert.equal(formatMoney(5, 'GBP'), '£0.05');
});
