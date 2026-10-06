import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ImageResolver } from '../src/index.ts';

/** A real (unreachable) client whose `send` is mocked so nothing leaves the process — no item ever cached, every write accepted. */
function fakeTable(t: TestContext): DynamoDBClient {
  const client = new DynamoDBClient({ region: 'local', endpoint: 'http://127.0.0.1:1', credentials: { accessKeyId: 'x', secretAccessKey: 'x' } });
  t.mock.method(client, 'send', async () => ({}));
  return client;
}

test('a line with no GTIN never calls a chain\'s own site (ADR 0011: no such call from the API)', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response(null, { status: 404 });
  });

  const resolver = new ImageResolver('table', fakeTable(t));
  const ref = await resolver.resolve({ name: 'קפה שחור' });

  assert.equal(ref, null, 'no source answers a bare name');
  assert.equal(calls.length, 0, 'a name with no barcode triggers no network call at all from here');
});

test('a GTIN is looked up only at the static image CDN and Open Food Facts, never a chain\'s dynamic site', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return new Response(null, { status: 404 });
  });

  const resolver = new ImageResolver('table', fakeTable(t));
  await resolver.resolve({ gtin: '7290000000001' });

  assert.ok(calls.every((u) => u.includes('img.rami-levy.co.il') || u.includes('openfoodfacts.org')), `only static/global sources are called, got: ${calls.join(', ')}`);
  assert.ok(!calls.some((u) => u.includes('rami-levy.co.il/api/catalog') || u.includes('shufersal.co.il')), 'never a chain\'s own dynamic catalogue or search from the API');
});

test('the static image CDN answers a real jpeg for a GTIN', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } }));

  const resolver = new ImageResolver('table', fakeTable(t));
  const ref = await resolver.resolve({ gtin: '7290000000001' });

  assert.deepEqual(ref, { url: 'https://img.rami-levy.co.il/product/7290000000001/small.jpg', source: 'rami-levy' });
});
