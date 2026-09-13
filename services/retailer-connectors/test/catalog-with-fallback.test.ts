import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogWithFallback } from '../src/catalog-with-fallback.ts';
import type { CatalogProvider } from '../src/quote-provider.ts';
import type { ProductCandidate } from '@fca/domain';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const candidate = (productId: string): ProductCandidate => ({ productId, name: productId, pricedAtChains: 1 });
const unpriced = (productId: string): ProductCandidate => ({ productId, name: productId, pricedAtChains: 0 });

const provider = (impl: CatalogProvider['searchProducts'], id = 'primary'): CatalogProvider => ({ id, searchProducts: impl });

test('a fast, successful provider answer wins — the fallback is never asked', async () => {
  let fallbackCalled = false;
  const primary = provider(async () => [candidate('primary-1')]);
  const fallback = { searchProducts: async () => { fallbackCalled = true; return [candidate('fallback-1')]; } };
  const products = await new CatalogWithFallback(primary, fallback, 2_500).searchProducts({ query: 'חלב' });
  assert.deepEqual(products.map((p) => p.productId), ['primary-1']);
  assert.equal(fallbackCalled, false);
});

test('a real empty answer from the provider is trusted — not every miss is a failure', async () => {
  const primary = provider(async () => []);
  const fallback = { searchProducts: async () => [candidate('fallback-1')] };
  const products = await new CatalogWithFallback(primary, fallback, 2_500).searchProducts({ query: 'nonsense' });
  assert.deepEqual(products, []);
});

test('the provider erring (internal_error) hands over to the chain catalogue immediately', async () => {
  const primary = provider(async () => { throw new Error('search_products: Error: Internal server error (code: internal_error)'); });
  const fallback = { searchProducts: async () => [candidate('fallback-1')] };
  const products = await new CatalogWithFallback(primary, fallback, 2_500).searchProducts({ query: 'טופו' });
  assert.deepEqual(products.map((p) => p.productId), ['fallback-1']);
});

test('the provider taking longer than the race budget hands over to the fast fallback', async () => {
  const primary = provider(async () => { await sleep(200); return [candidate('primary-late')]; });
  const fallback = { searchProducts: async () => [candidate('fallback-1')] };
  const products = await new CatalogWithFallback(primary, fallback, 20).searchProducts({ query: 'שוקולד' });
  assert.deepEqual(products.map((p) => p.productId), ['fallback-1']);
});

test('the provider erring with a fallback that also fails surfaces the provider error', async () => {
  const primary = provider(async () => { throw new Error('internal_error'); });
  const fallback = { searchProducts: async () => { throw new Error('rami-levy down too'); } };
  await assert.rejects(() => new CatalogWithFallback(primary, fallback, 20).searchProducts({ query: 'x' }), /internal_error/);
});

test('a slow provider with no help from the fallback is still answered once it lands, not reported empty', async () => {
  const primary = provider(async () => { await sleep(20); return [candidate('primary-late')]; });
  const fallback = { searchProducts: async () => [] as ProductCandidate[] };
  const products = await new CatalogWithFallback(primary, fallback, 5).searchProducts({ query: 'x' });
  assert.deepEqual(products.map((p) => p.productId), ['primary-late']);
});

test('the provider naming real products but pricing none of them hands over to the chain catalogue (ביצים, סלמון, 2026-09-13)', async () => {
  const primary = provider(async () => [unpriced('egg-1'), unpriced('egg-2')]);
  const fallback = { searchProducts: async () => [candidate('rami-levy-egg')] };
  const products = await new CatalogWithFallback(primary, fallback, 2_500).searchProducts({ query: 'ביצים' });
  assert.deepEqual(products.map((p) => p.productId), ['rami-levy-egg']);
});

test('unpriced products from the provider are still returned if the fallback has nothing either', async () => {
  const primary = provider(async () => [unpriced('egg-1')]);
  const fallback = { searchProducts: async () => [] as ProductCandidate[] };
  const products = await new CatalogWithFallback(primary, fallback, 2_500).searchProducts({ query: 'ביצים' });
  assert.deepEqual(products.map((p) => p.productId), ['egg-1']);
});
