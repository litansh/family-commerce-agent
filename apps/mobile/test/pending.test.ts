/**
 * Promise 6: "a purchase is confirmed from history without a tap." This logic had no lab at all —
 * a regression here would fail silently (the family keeps getting asked "did you buy it?" forever).
 * AsyncStorage is mocked because there is no device here; `pending.ts` only ever awaits it, never
 * reads the result back within a test's lifetime.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('@react-native-async-storage/async-storage', {
  defaultExport: { getItem: async () => null, setItem: async () => {} },
});

// A fresh module per test: `pending.ts` keeps its list in module-scope state, like the app does
// for the life of one launch, so each test gets its own "launch" rather than leaking into the next.
const fresh = async () => import(`../src/lib/pending.ts?t=${Math.random()}`) as Promise<typeof import('../src/lib/pending.ts')>;

test('sameProduct: a shared barcode matches even where the names have no word in common', async () => {
  const { sameProduct } = await fresh();
  assert.equal(sameProduct({ name: 'משהו אחר לגמרי', gtin: '111' }, { name: 'עוד משהו', code: '111' }), true);
});

test('sameProduct: the real incident — a Tnuva bag confirmed by a Yotvata carton the store actually delivered', async () => {
  const { sameProduct } = await fresh();
  // packages/domain/test/memory.test.ts documents the same substitution breaking memory once;
  // the purchase-confirmation match must survive it too, or the family is asked "did you buy milk?"
  // right after they did.
  assert.equal(sameProduct({ name: 'חלב 3%', gtin: 'tnuva-bag' }, { name: 'חלב יטבתה 2 ליטר', code: 'yotvata-carton' }), true);
});

test('sameProduct: unrelated products never match', async () => {
  const { sameProduct } = await fresh();
  assert.equal(sameProduct({ name: 'חלב 3%' }, { name: 'לחם אחיד פרוס' }), false);
});

test('confirmFromHistory: most lines matching confirms the whole cart, and clears it from pending', async () => {
  const { addPending, confirmFromHistory, pendingFor } = await fresh();
  const p = addPending('rami-levy', [
    { name: 'חלב 3%', gtin: 'tnuva-bag', qty: 4 },
    { name: 'ביצים L', gtin: 'eggs-12', qty: 2 },
    { name: 'פילה סלמון', gtin: 'salmon', qty: 1 },
  ]);
  const day = p.at.slice(0, 10);
  const done = confirmFromHistory('rami-levy', [
    { at: day, lines: [{ name: 'חלב יטבתה 2 ליטר', code: 'yotvata-carton' }, { name: 'ביצים L חופש', code: 'eggs-12' }] },
  ]);
  assert.equal(done.length, 1, 'two of three lines matched — the order minimum');
  assert.equal(done[0]?.id, p.id);
  assert.equal(pendingFor('rami-levy'), undefined, 'confirmed, so no longer pending');
});

test('confirmFromHistory: fewer than half the lines matching leaves the family the fallback question', async () => {
  const { addPending, confirmFromHistory, pendingFor } = await fresh();
  const p = addPending('rami-levy', [
    { name: 'חלב 3%', gtin: 'tnuva-bag', qty: 4 },
    { name: 'ביצים L', gtin: 'eggs-12', qty: 2 },
    { name: 'פילה סלמון', gtin: 'salmon', qty: 1 },
    { name: 'קמח לבן', gtin: 'flour', qty: 1 },
  ]);
  const day = p.at.slice(0, 10);
  const done = confirmFromHistory('rami-levy', [{ at: day, lines: [{ name: 'קמח לבן', code: 'flour' }] }]);
  assert.equal(done.length, 0, 'only one of four lines — below the half-of-the-cart floor');
  assert.equal(pendingFor('rami-levy')?.id, p.id, 'still pending — the "did you buy it?" fallback stands');
});

test('confirmFromHistory: an order dated before the cart was filled never confirms it', async () => {
  const { addPending, confirmFromHistory, pendingFor } = await fresh();
  const p = addPending('rami-levy', [{ name: 'חלב 3%', gtin: 'tnuva-bag', qty: 4 }]);
  const yesterday = new Date(Date.parse(p.at) - 86_400_000).toISOString().slice(0, 10);
  const done = confirmFromHistory('rami-levy', [{ at: yesterday, lines: [{ name: 'חלב 3%', code: 'tnuva-bag' }] }]);
  assert.equal(done.length, 0, 'an order before the cart cannot be the order this cart led to');
  assert.equal(pendingFor('rami-levy')?.id, p.id);
});

test('confirmFromHistory: only the matching store resolves; another store’s pending purchase is untouched', async () => {
  const { addPending, confirmFromHistory, pendingFor } = await fresh();
  const ramiLevy = addPending('rami-levy', [{ name: 'חלב 3%', gtin: 'tnuva-bag', qty: 4 }]);
  const victory = addPending('victory', [{ name: 'חלב 3%', gtin: 'tnuva-bag', qty: 4 }]);
  const done = confirmFromHistory('rami-levy', [{ at: ramiLevy.at.slice(0, 10), lines: [{ name: 'חלב 3%', code: 'tnuva-bag' }] }]);
  assert.equal(done.length, 1);
  assert.equal(pendingFor('rami-levy'), undefined);
  assert.equal(pendingFor('victory')?.id, victory.id, 'a different store’s open question is not this order’s business');
});
