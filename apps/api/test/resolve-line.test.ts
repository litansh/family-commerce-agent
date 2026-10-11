import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProductCandidate } from '@fca/domain';
import { resolveLine } from '../src/resolve-line.ts';

const milk: ProductCandidate = { productId: 'm1', gtin: '7290000042015', name: 'חלב 3% שומן שקית 1 ליטר פיקוח', pricedAtChains: 3 };
const halva: ProductCandidate = { productId: 'h1', name: 'חלבה נוגט כשר חלבי משקל', pricedAtChains: 1 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// A catalogue whose answer and speed depend on the words asked (the provider on a slow morning).
const catalog = (by: Record<string, { ms: number; products?: ProductCandidate[]; fail?: true }>) => ({
  asked: [] as string[],
  async searchProducts(req: { query: string }) {
    this.asked.push(req.query);
    const r = by[req.query] ?? { ms: 0, products: [] };
    await sleep(r.ms);
    if (r.fail) throw new Error('internal_error');
    return r.products ?? [];
  },
});

test('the repaired words answer even when the words as typed run out of time (chaos "חלב milk 3%", slow mornings)', async () => {
  // Production 2026-10-07/09/11: the chaotic /resolve took 13.5-14.5 s and the mixed line came back
  // unresolved; the old code only asked for "חלב 3%" after "חלב milk 3%" answered, and a deadline on
  // the first search threw the whole line away.
  const cat = catalog({ 'חלב milk 3%': { ms: 200, products: [halva] }, 'חלב 3%': { ms: 10, products: [milk] } });
  const c = await resolveLine(cat, { id: 'x-mixed', query: 'חלב milk 3%' }, 'רמת גן', 100);
  assert.equal(c?.chosen.gtin, milk.gtin);
  assert.equal(c?.query, 'חלב milk 3%', 'the line keeps the family\'s own words');
  assert.match(c?.note ?? '', /חלב 3%/);
});

test('the two rungs run side by side, so both fit the one line budget', async () => {
  const cat = catalog({ 'חלב milk 3%': { ms: 60, products: [halva] }, 'חלב 3%': { ms: 60, products: [milk] } });
  const t = Date.now();
  const c = await resolveLine(cat, { id: 'x-mixed', query: 'חלב milk 3%' }, undefined, 100);
  assert.equal(c?.chosen.gtin, milk.gtin, 'sequential would need 120 ms of a 100 ms budget');
  assert.ok(Date.now() - t < 100);
});

test('a failing first rung does not sink a repaired one, nor the other way round', async () => {
  const a = await resolveLine(catalog({ 'חלב milk 3%': { ms: 0, fail: true }, 'חלב 3%': { ms: 0, products: [milk] } }), { id: 'x', query: 'חלב milk 3%' }, undefined, 100);
  assert.equal(a?.chosen.gtin, milk.gtin);
  const b = await resolveLine(catalog({ 'חלב 3% 1 ליטר': { ms: 0, products: [milk] } }), { id: 'y', query: 'חלב 3% 1 ליטר' }, undefined, 100);
  assert.equal(b?.chosen.gtin, milk.gtin, 'nothing to repair: one search, as before');
});

test('the words as typed still win when they answer, and nothing honest is still nothing', async () => {
  const cat = catalog({ 'חלב milk 3%': { ms: 0, products: [{ ...milk, productId: 'm2', gtin: 'typed' }] }, 'חלב 3%': { ms: 0, products: [milk] } });
  assert.equal((await resolveLine(cat, { id: 'x', query: 'חלב milk 3%' }, undefined, 100))?.chosen.gtin, 'typed');
  assert.equal(await resolveLine(catalog({ 'חלב milk 3%': { ms: 0, products: [halva] } }), { id: 'x', query: 'חלב milk 3%' }, undefined, 100), undefined, 'halva is never milk');
});

test('every rung failing is an error the route lists as unresolved', async () => {
  await assert.rejects(resolveLine(catalog({ 'חלב milk 3%': { ms: 0, fail: true }, 'חלב 3%': { ms: 0, fail: true } }), { id: 'x', query: 'חלב milk 3%' }, undefined, 100));
});
