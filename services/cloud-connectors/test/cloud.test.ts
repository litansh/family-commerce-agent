import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieHeader, cookieValue, type CapturedSession } from '../src/cookie-jar.ts';
import { ShufersalCloud, SessionExpired } from '../src/shufersal-cloud.ts';

const session: CapturedSession = {
  retailer: 'shufersal',
  capturedAt: new Date().toISOString(),
  cookies: [
    { name: 'JSESSIONID', value: 'abc', domain: '.shufersal.co.il' },
    { name: 'XSRF-TOKEN', value: 'tok123', domain: '.shufersal.co.il' },
    { name: 'other', value: 'x', domain: '.example.com' },
  ],
};

test('cookie header carries only the host cookies, csrf value is findable', () => {
  const h = cookieHeader(session, 'www.shufersal.co.il');
  assert.ok(h.includes('JSESSIONID=abc') && h.includes('XSRF-TOKEN=tok123'));
  assert.ok(!h.includes('other=x'), 'foreign-domain cookie excluded');
  assert.equal(cookieValue(session, 'XSRF-TOKEN'), 'tok123');
});

test('an expired session is reported, not silently empty', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response('false', { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(() => new ShufersalCloud(session).orderHistory(), SessionExpired);
  } finally { globalThis.fetch = orig; }
});

test('history parses closedOrders and their entries, dropping delivery lines', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.endsWith('get-status-includes-otp')) return new Response('true');
    if (u.endsWith('/my-account/orders')) return new Response(JSON.stringify({ closedOrders: [{ code: 'O1', placed: '2026-09-01' }] }));
    if (u.endsWith('/my-account/orders/O1')) return new Response(JSON.stringify({ entries: [
      { product: { name: 'חלב תנובה', ean: '729000' }, quantity: 2 },
      { product: { name: 'דמי משלוח' }, quantity: 1 },
    ] }));
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const h = await new ShufersalCloud(session).orderHistory();
    assert.equal(h.length, 1);
    assert.equal(h[0]!.lines.length, 1, 'the delivery line is dropped');
    assert.equal(h[0]!.lines[0]!.name, 'חלב תנובה');
    assert.equal(h[0]!.lines[0]!.qty, 2);
  } finally { globalThis.fetch = orig; }
});
