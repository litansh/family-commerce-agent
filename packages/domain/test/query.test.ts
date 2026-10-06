import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairQuery } from '../src/query.ts';

test('a final letter typed as its middle form is written the way the catalogue spells it (ops/chaos.mjs: "מלפפונימ")', () => {
  assert.equal(repairQuery('מלפפונימ'), 'מלפפונים');
  assert.equal(repairQuery('לחמ אחיד'), 'לחם אחיד');
});

test('an English word beside the Hebrew is dropped, numbers kept (ops/chaos.mjs: "חלב milk 3%")', () => {
  assert.equal(repairQuery('חלב milk 3%'), 'חלב 3%');
});

test('nothing to repair is undefined, so the caller never searches the same words twice', () => {
  assert.equal(repairQuery('מלפפונים'), undefined);
  assert.equal(repairQuery('חלב 3%'), undefined);
  assert.equal(repairQuery('olive oil'), undefined); // an all-English line is a real query
  assert.equal(repairQuery('   '), undefined);
  assert.equal(repairQuery('12345'), undefined);
});
