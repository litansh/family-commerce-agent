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

test('when the first chain has no picture, the second is asked (ADR 0010)', async () => {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url).includes('shufersal') ? 'shufersal' : 'rami');
    return String(url).includes('shufersal')
      ? { ok: true, json: async () => ({ results: [{ code: '7290001201510', name: 'ביצים 30', images: [{ format: 'product', url: 'https://res.cloudinary.com/shufersal/eggs.jpg' }] }] }) }
      : { ok: true, json: async () => ({ data: [{ barcode: 1, images: {} }] }) };
  }) as unknown as typeof fetch;
  const real = globalThis.fetch; globalThis.fetch = impl;
  try {
    const r = await imageByName('ביצים 30 יחידות');
    assert.equal(r?.url, 'https://res.cloudinary.com/shufersal/eggs.jpg');
    assert.equal(r?.gtin, '7290001201510');
    assert.deepEqual(calls, ['rami', 'shufersal'], 'the chain catalogue is asked first, Shufersal only when it has nothing');
  } finally { globalThis.fetch = real; }
});
