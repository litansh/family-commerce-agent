import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, sizeFromName } from '../src/size.ts';

test('sizes read the way a person says them', () => {
  assert.equal(formatSize(1000, 'ml'), '1 ליטר');
  assert.equal(formatSize(1500, 'ml'), '1.5 ליטר');
  assert.equal(formatSize(330, 'ml'), '330 מ״ל');
  assert.equal(formatSize(250, 'g'), '250 גרם');
  assert.equal(formatSize(1000, 'g'), '1 ק״ג');
  assert.equal(formatSize(12, 'unit'), '12 יח׳');
  assert.equal(formatSize(undefined, 'g'), undefined);
});

test('a store name carries the size when the catalogue does not', () => {
  assert.equal(sizeFromName('חלב תנובה 3% 1 ליטר'), '1 ליטר');
  assert.equal(sizeFromName('קוטג\' 5% 250 גרם'), '250 גרם');
  assert.equal(sizeFromName('ביצים 12 יח גדול L'), '12 יח׳');
  assert.equal(sizeFromName('מים מינרליים 1.5L שישייה'), '1.5 ליטר');
  assert.equal(sizeFromName('במבה'), undefined);
});
