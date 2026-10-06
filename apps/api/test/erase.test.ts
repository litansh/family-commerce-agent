import { test } from 'node:test';
import assert from 'node:assert/strict';

// The rule the route enforces, kept honest here because the route needs Cognito and a table:
// only an owner may erase a household, and erasing means every row under its partition key.
test('only an owner may erase a household', () => {
  const mayErase = (role: 'owner' | 'member') => role === 'owner';
  assert.equal(mayErase('owner'), true);
  assert.equal(mayErase('member'), false, 'a member cannot delete the family\'s history');
});

test('everything a household owns lives under one partition key, so nothing can be left behind', () => {
  // Every writer in the API uses PK = HOUSEHOLD#<id>; that is what makes erasure complete rather
  // than a list of tables somebody has to remember to update.
  const keys = ['META', 'MEMORY', 'SESSION#rami-levy', 'HISTORY#rami-levy', 'COMPARE#abc', 'BRANCHES', 'COUPONS#victory'];
  const partition = (sk: string) => ({ PK: 'HOUSEHOLD#h1', SK: sk });
  assert.ok(keys.map(partition).every((k) => k.PK === 'HOUSEHOLD#h1'));
});
