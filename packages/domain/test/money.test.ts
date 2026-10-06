import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAgorot, agorot, formatILS, scaleAgorot, shekels, subAgorot } from '../src/money.ts';

test('shekels converts without float drift', () => {
  assert.equal(shekels(35.9), 3590);
  assert.equal(shekels(836.2), 83620);
  assert.equal(shekels(0.1) + shekels(0.2), shekels(0.3)); // the classic float trap
});

test('shekels rounds half away from zero', () => {
  assert.equal(shekels(1.005), 101);
  assert.equal(shekels(-1.005), -101);
});

test('agorot rejects non-integers', () => {
  assert.throws(() => agorot(1.5), RangeError);
});

test('a 36-line basket sums exactly', () => {
  const lines = Array.from({ length: 36 }, () => shekels(23.31));
  assert.equal(addAgorot(...lines), 83916);
});

test('scaleAgorot handles fractional quantities', () => {
  assert.equal(scaleAgorot(shekels(12.9), 2.5), shekels(32.25));
});

test('subAgorot can go negative', () => {
  assert.equal(subAgorot(shekels(10), shekels(15)), shekels(-5));
});

test('formatILS pads agorot', () => {
  assert.equal(formatILS(shekels(836.2)), '₪836.20');
  assert.equal(formatILS(shekels(836.05)), '₪836.05');
  assert.equal(formatILS(shekels(-67)), '-₪67.00');
});
