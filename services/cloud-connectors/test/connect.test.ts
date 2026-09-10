import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, newKey } from '../src/seal.ts';
import { cookiesFrom, mergeCookies, mask, localPhone, ConnectFailed } from '../src/driver.ts';
import { shufersalDriver } from '../src/drivers/shufersal.ts';
import { haziHinamDriver } from '../src/drivers/hazi-hinam.ts';
import { driverFor } from '../src/drivers/index.ts';

test('sealed sessions round-trip and are bound to their household/store', () => {
  const key = newKey();
  const s = seal({ cookies: [{ name: 'JSESSIONID', value: 'x' }] }, key, 'h1/shufersal');
  assert.deepEqual(open(s, key, 'h1/shufersal'), { cookies: [{ name: 'JSESSIONID', value: 'x' }] });
  assert.throws(() => open(s, key, 'h2/shufersal'), 'a blob moved to another household must not open');
  assert.throws(() => open(s, newKey(), 'h1/shufersal'), 'a different key must not open');
  assert.throws(() => seal({}, 'short', 'a'), /32 bytes/);
});

test('cookies are read from Set-Cookie, merged by name; phones and masks are tidy', () => {
  const res = new Response('', { headers: [['set-cookie', 'A=1; Path=/'], ['set-cookie', 'B=2; HttpOnly'], ['set-cookie', 'A=3']] });
  const got = cookiesFrom(res, '.example.com');
  assert.deepEqual(got.map((c) => `${c.name}=${c.value}`), ['A=3', 'B=2']);
  assert.deepEqual(mergeCookies([{ name: 'A', value: '0' }, { name: 'Z', value: 'z' }], got).map((c) => `${c.name}=${c.value}`), ['A=3', 'Z=z', 'B=2']);
  assert.equal(localPhone('+972 50-123 4567'), '0501234567');
  assert.equal(localPhone('12345'), null);
  assert.equal(mask('0501234567'), '05••••••67');
  assert.equal(mask('lab@example.com'), 'l••@example.com');
});

/** A fetch stub keyed by URL substring; each entry may be a Response or a function of the request. */
function stubFetch(routes: Record<string, Response | ((url: string, init?: RequestInit) => Response)>): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('not stubbed: ' + url, { status: 599 });
    const r = hit[1];
    return typeof r === 'function' ? r(url, init) : r.clone();
  }) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

test('shufersal: wrong password is reported as such, never as a session', async () => {
  const restore = stubFetch({
    '/online/he/login': new Response('<input name="CSRFToken" value="tok" />', { status: 200, headers: [['set-cookie', 'JSESSIONID=pre; Path=/online'], ['set-cookie', 'XSRF-TOKEN=tok']] }),
    '/j_spring_security_check': new Response('', { status: 302, headers: { location: 'https://www.shufersal.co.il/online/he/login/?error=true' } }),
  });
  try {
    await assert.rejects(() => shufersalDriver.passwordLogin!('a@b.c', 'nope'), (e: unknown) => e instanceof ConnectFailed && e.reason === 'wrong_password');
  } finally { restore(); }
});

test('shufersal: a good password yields a session the store itself confirms, with the posted form shape', async () => {
  let posted = '';
  const restore = stubFetch({
    '/online/he/login': new Response('<input name="CSRFToken" value="tok" />', { status: 200, headers: [['set-cookie', 'JSESSIONID=pre; Path=/online'], ['set-cookie', 'XSRF-TOKEN=tok']] }),
    '/j_spring_security_check': (_u, init) => { posted = String(init?.body); return new Response('', { status: 302, headers: [['location', 'https://www.shufersal.co.il/online/he/'], ['set-cookie', 'JSESSIONID=real; Path=/online; HttpOnly'], ['set-cookie', 'miglogstorefrontRememberMe=r']] }); },
    '/authentication/get-status-includes-otp': new Response('{"loggedIn":true}', { status: 200 }),
  });
  try {
    const s = await shufersalDriver.passwordLogin!('a@b.c', 'p@ss w');
    const p = new URLSearchParams(posted);
    assert.equal(p.get('j_username'), 'a@b.c'); assert.equal(p.get('j_password'), 'p@ss w'); assert.equal(p.get('CSRFToken'), 'tok'); assert.equal(p.get('remember-me'), 'True');
    assert.equal(s.cookies.find((c) => c.name === 'JSESSIONID')?.value, 'real', 'the post-login session cookie replaces the pre-login one');
    assert.ok(s.cookies.some((c) => c.name === 'miglogstorefrontRememberMe'));
    assert.equal(s.retailer, 'shufersal');
  } finally { restore(); }
});

test('hazi hinam: 400 is wrong details; 200 + user info is a session carrying its token', async () => {
  const restore = stubFetch({ '/proxy/Login': new Response('{"error":"אחד הפרטים שהכנסתם שגוי"}', { status: 400 }) });
  try { await assert.rejects(() => haziHinamDriver.passwordLogin!('x', 'y'), (e: unknown) => e instanceof ConnectFailed && e.reason === 'wrong_password'); } finally { restore(); }
  let auth = '';
  const restore2 = stubFetch({
    '/proxy/Login': new Response('{"Results":{"AccessToken":"abcdefghijk","Refresh_Token":"zzzzzzzzzz"}}', { status: 200, headers: [['set-cookie', 'H_UUID=u; Path=/; HttpOnly']] }),
    '/proxy/api/user/info': (_u, init) => { auth = String((init?.headers as Record<string, string>)['authorization'] ?? ''); return new Response('{"UserInfo":{"FirstName":"Lab"}}'); },
  });
  try {
    const s = await haziHinamDriver.passwordLogin!('lab@example.com', 'pw');
    assert.equal(s.tokens?.['access_token'], 'abcdefghijk');
    assert.equal(s.tokens?.['refresh_token'], 'zzzzzzzzzz');
    assert.equal(auth, 'Bearer abcdefghijk');
    assert.ok(s.cookies.some((c) => c.name === 'H_UUID'));
  } finally { restore2(); }
});

test('the registry knows exactly the stores the cloud can sign in to', () => {
  assert.ok(driverFor('shufersal')?.password);
  assert.ok(driverFor('hazi-hinam')?.password);
  assert.equal(driverFor('rami-levy'), undefined, 'captcha-gated: phone only');
  assert.equal(driverFor('victory'), undefined, 'stor.ai: phone only');
});
