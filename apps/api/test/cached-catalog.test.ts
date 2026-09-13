import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKey } from '../src/cached-catalog.ts';

test('the key is the question actually asked: words, brand and city', () => {
  const k = (r: Parameters<typeof searchKey>[0]) => searchKey(r);
  // Spacing and case are not different questions.
  assert.equal(k({ query: '  חלב  תנובה ', limit: 8 }), k({ query: 'חלב תנובה', limit: 8 }));
  // A different city is a different answer: which storefronts price a product depends on where you live.
  assert.notEqual(k({ query: 'חלב', limit: 8, location: 'ויצמן 1, כפר סבא' }), k({ query: 'חלב', limit: 8, location: 'דיזנגוף 1, תל אביב' }));
  // The same city reached by different streets is the same question, so a family's neighbours share the lookup.
  assert.equal(k({ query: 'חלב', limit: 8, location: 'ויצמן 1, כפר סבא' }), k({ query: 'חלב', limit: 8, location: 'הרצל 9, כפר סבא' }));
  // A brand filter changes the answer.
  assert.notEqual(k({ query: 'חלב', brand: 'תנובה', limit: 8 }), k({ query: 'חלב', limit: 8 }));
});
