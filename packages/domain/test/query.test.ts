import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWordToQuote, repairQuery } from '../src/query.ts';

test('a line with no word in it has nothing to quote (ops/chaos.mjs: emoji, a bare number, 200 letters)', () => {
  for (const q of ['🍕🥑🧻🔥🥩', '12345', 'א'.repeat(200), 'אאאא', '3%', 'L', '', '   ', '— !']) assert.equal(hasWordToQuote(q), false, JSON.stringify(q.slice(0, 12)));
});

test('every real line still has something to quote, niqqud, brands and sizes included', () => {
  for (const q of ['חלב 3% 1 ליטר', 'ביצים L', 'חָלָב', '7up', 'AA', 'olive oil', 'חלב milk 3%', 'מלפפונימ', 'לא קיים', 'מיץ קקטוס קפוא נדיר מהחלל', 'נייר טואלט 32', 'קוטג\' 5%']) assert.equal(hasWordToQuote(q), true, q);
});

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
