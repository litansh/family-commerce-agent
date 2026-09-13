import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageByName } from '../src/lib/storeImages.ts';

const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { await run(); } finally { globalThis.fetch = real; }
};
const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

test('the chain\'s own picture, with the barcode it belongs to', async () => {
  await withFetch(answer({ data: [{ barcode: 7290018711095, name: 'קפה טורקי', images: { small: '/product/7290018711095/small.jpg' } }] }), async () => {
    const r = await imageByName('קפה שחור');
    assert.equal(r?.url, 'https://img.rami-levy.co.il/product/7290018711095/small.jpg');
    assert.equal(r?.gtin, '7290018711095');
  });
});

test('a row without a picture, a refusal, or a thrown request all answer nothing', async () => {
  await withFetch(answer({ data: [{ barcode: 1, images: {} }] }), async () => assert.equal(await imageByName('x y'), undefined));
  await withFetch(answer({}, false), async () => assert.equal(await imageByName('x y'), undefined));
  await withFetch(((() => { throw new Error('offline'); }) as unknown) as typeof fetch, async () => assert.equal(await imageByName('x y'), undefined));
});

test('a name too short to mean anything is not asked about', async () => {
  await withFetch((() => { throw new Error('should not be called'); }) as unknown as typeof fetch, async () => {
    assert.equal(await imageByName(' '), undefined);
  });
});
