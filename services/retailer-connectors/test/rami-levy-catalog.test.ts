import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRamiLevyCatalog, RamiLevyCatalogSearch } from '../src/rami-levy-catalog.ts';

// A trimmed real answer from https://www.rami-levy.co.il/api/catalog? for {"q":"טופו","size":5}.
const TOFU_ROW = {
  id: 342647,
  barcode: 7290110322014,
  name: 'טופו בטעם טבעי אלטרנטיב 300 גרם עד"ח',
  price: { price: 13.6 },
  gs: { BrandName: 'אלטרנטיב' },
};

test('a catalogue row becomes a buyable candidate: barcode, name, brand from gs, price, one chain', () => {
  const [c] = parseRamiLevyCatalog([TOFU_ROW]);
  assert.equal(c?.productId, 'rami-levy:342647');
  assert.equal(c?.gtin, '7290110322014');
  assert.equal(c?.name, TOFU_ROW.name);
  assert.equal(c?.brand, 'אלטרנטיב');
  assert.equal(c?.rawBrand, 'אלטרנטיב');
  assert.equal(c?.fromPrice, 1360);
  assert.equal(c?.pricedAtChains, 1);
});

test('a row missing an id or a name is dropped rather than reaching the family as a blank card', () => {
  assert.deepEqual(parseRamiLevyCatalog([{ name: 'x' }, { id: 1 }, {}]), []);
});

test('no barcode, no price and no brand still yields a candidate — the name is not nothing', () => {
  const [c] = parseRamiLevyCatalog([{ id: 1, name: 'משהו' }]);
  assert.equal(c?.name, 'משהו');
  assert.equal(c?.gtin, undefined);
  assert.equal(c?.fromPrice, undefined);
  assert.equal(c?.pricedAtChains, 1);
});

test('the search asks {q,size} and parses the data array', async () => {
  const seen: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, opts: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(opts.body)) });
    return new Response(JSON.stringify({ data: [TOFU_ROW] }), { status: 200 });
  }) as unknown as typeof fetch;
  const products = await new RamiLevyCatalogSearch().searchProducts({ query: 'טופו', limit: 5 }, fetchImpl);
  assert.equal(seen[0]?.url, 'https://www.rami-levy.co.il/api/catalog?');
  assert.deepEqual(seen[0]?.body, { q: 'טופו', size: 5 });
  assert.equal(products.length, 1);
  assert.equal(products[0]?.gtin, '7290110322014');
});

test('an HTTP error is a rejection, not a silent empty answer — the race decides what to do with it', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => new RamiLevyCatalogSearch().searchProducts({ query: 'x' }, fetchImpl));
});
