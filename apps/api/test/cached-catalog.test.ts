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

test('a live price row adds to a remembered product and never takes away', async () => {
  // The bug this guards: the cache rebuilt `pricedAtChains` from live price rows, so where no row
  // existed yet it became 0, every candidate looked unsellable, and `resolve` returned null for all
  // eight lines of a real list on production.
  const { withLivePrice } = await import('../src/cached-catalog.ts');
  const remembered = { productId: 'p1', gtin: '7290004131074', name: 'חלב תנובה', pricedAtChains: 4 } as never;

  // No row yet: nothing is lost.
  assert.equal(withLivePrice(remembered, undefined).pricedAtChains, 4);
  // A row with no storefronts is not evidence that nobody sells it.
  assert.equal(withLivePrice(remembered, { prices: [] }).pricedAtChains, 4);
  // A row that knows more wins, and the price comes from it.
  const better = withLivePrice(remembered, { min: 690, prices: [{ storefrontId: 'a' }, { storefrontId: 'b' }, { storefrontId: 'c' }, { storefrontId: 'd' }, { storefrontId: 'e' }] });
  assert.equal(better.pricedAtChains, 5);
  assert.equal(better.fromPrice, 690);
  // The same storefront twice is one chain, and a row that knows less than the cache takes nothing
  // away: both are partial views, so the larger wins.
  assert.equal(withLivePrice(remembered, { prices: [{ storefrontId: 'a' }, { storefrontId: 'a' }] }).pricedAtChains, 4);
});

test('a cache hit never makes a product look unbuyable', async () => {
  // The bug this guards: the cache dropped `pricedAtChains` and rebuilt it from live price rows.
  // Where no row existed yet it became 0, every candidate looked unsellable, and `resolve` returned
  // null for all eight lines of a real list on production. A cache may add knowledge, never remove it.
  const candidate = { productId: 'p1', gtin: '7290004131074', name: 'חלב', pricedAtChains: 4 } as const;
  const store = new Map<string, unknown>();
  const fakeDoc = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, { SK?: string } & Record<string, unknown>> }) => {
      const name = cmd.constructor.name;
      const sk = String(cmd.input['Key']?.SK ?? cmd.input['Item']?.['SK'] ?? '');
      if (name === 'PutCommand') { store.set(sk, cmd.input['Item']); return {}; }
      return { Item: store.get(sk) };   // GetCommand: PRICE# rows are absent, as they are for a new product
    },
  };
  const inner = { id: 'fake', searchProducts: async () => [candidate] };
  const { CachedCatalog } = await import('../src/cached-catalog.ts');
  const c = new CachedCatalog(inner as never, 'fca-main');
  (c as unknown as { '#doc': unknown })['#doc'] = fakeDoc;
  Object.defineProperty(c, 'doc', { value: fakeDoc });
  const first = await c.searchProducts({ query: 'חלב', limit: 8 });
  assert.equal(first[0]?.pricedAtChains, 4, 'a miss passes the provider through untouched');
});

test('the key carries a version, so rows written by older code are never read as current', () => {
  // A deploy fixes code in seconds; the rows it wrote live for a day. Without a version in the key,
  // the fixed build kept reading the broken build's rows and production stayed broken after the fix.
  assert.match(searchKey({ query: 'חלב', limit: 8 }), /^SEARCH#v\d+#/);
});
