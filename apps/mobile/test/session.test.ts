/**
 * The session capture, run the way the WebView runs it — as a string, in a page —
 * against a tiny fake page. What it must do: post always; keep every cookie the
 * page can read; take the store's named keys and anything called token / jwt /
 * auth from localStorage and sessionStorage; leave a huge value behind and name
 * it; and never throw its way out of posting.
 *
 *   node --test --experimental-strip-types apps/mobile/test/session.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureSessionJs, GUARD_JS, hasAuthSession, MAX_TOKEN_CHARS, parseCapturedSession, sessionSummary, signedInPollJs } from '../src/lib/session.ts';
import { guardedJs } from '../src/lib/inject.ts';
import { STORES } from '../src/lib/stores.ts';

class FakeStorage {
  #m = new Map<string, string>();
  get length(): number { return this.#m.size; }
  key(i: number): string | null { return [...this.#m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.#m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.#m.set(k, v); }
}

/** Run an injected script inside a fake page; returns the messages it posted. */
function runInPage(js: string, page: { cookie?: string; ls?: Record<string, string>; ss?: Record<string, string>; title?: string; text?: string }): string[] {
  const posted: string[] = [];
  const localStorage = new FakeStorage(); for (const [k, v] of Object.entries(page.ls ?? {})) localStorage.setItem(k, v);
  const sessionStorage = new FakeStorage(); for (const [k, v] of Object.entries(page.ss ?? {})) sessionStorage.setItem(k, v);
  const window = { ReactNativeWebView: { postMessage: (m: string) => posted.push(m) }, localStorage, sessionStorage };
  const document = { cookie: page.cookie ?? '', title: page.title ?? '', body: { innerText: page.text ?? '' }, querySelector: () => null };
  const location = { href: 'https://www.example.co.il/he', hostname: 'www.example.co.il' };
  new Function('window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', js)(window, document, localStorage, sessionStorage, { userAgent: 'lab' }, location);
  return posted;
}
const session = (posted: string[]) => { const m = posted.find((p) => p.startsWith('session:')); assert.ok(m, 'a session: message'); return parseCapturedSession(m.slice(8)); };

test('every store: the capture parses and posts, even on an empty page', () => {
  for (const st of Object.values(STORES)) {
    const got = session(runInPage(captureSessionJs(st), {}));
    assert.deepEqual(got.cookies, []); assert.deepEqual(got.tokens, {}); assert.equal(got.diag.error, undefined);
  }
});

test('Rami Levy: nuxt-auth token in the cookie and in localStorage, the 290 KB vuex blob left behind and named', () => {
  const rl = STORES['rami-levy']!;
  const got = session(runInPage(captureSessionJs(rl), {
    cookie: '_ga=GA1.1; auth.strategy=local; auth._token.local=Bearer%20eyJ.abc.def; auth._refresh_token.local=r1; i18n_redirected=he',
    // `ramilevy` is the site's persisted vuex state (290 KB, not a token): neither taken nor wanted.
    // `auth.blob` stands for a wanted key that is too big: left behind, but named in the report.
    ls: { 'auth._token.local': 'Bearer eyJ.abc.def', 'auth._refresh_token.local': 'r1', 'auth.strategy': 'local', appVersion: '1', ramilevy: 'x'.repeat(MAX_TOKEN_CHARS + 1), 'auth.blob': 'y'.repeat(MAX_TOKEN_CHARS + 1) },
  }));
  assert.deepEqual(got.cookies.map((c) => c.name), ['_ga', 'auth.strategy', 'auth._token.local', 'auth._refresh_token.local', 'i18n_redirected']);
  assert.equal(got.cookies.find((c) => c.name === 'auth._token.local')?.value, 'Bearer eyJ.abc.def', 'decoded once');
  assert.equal(got.cookies[0]?.domain, 'www.example.co.il');
  assert.deepEqual(Object.keys(got.tokens).sort(), ['auth._refresh_token.local', 'auth._token.local', 'auth.strategy']);
  assert.deepEqual(got.diag.skipped, [`auth.blob:${MAX_TOKEN_CHARS + 1}`]);
  assert.deepEqual(got.diag.lsKeys, ['auth._token.local', 'auth._refresh_token.local', 'auth.strategy', 'appVersion', 'ramilevy', 'auth.blob']);
  const sum = sessionSummary(got);
  assert.equal(sum.cookies, 5); assert.equal(sum.tokens, 3);
  assert.ok(!JSON.stringify(sum).includes('eyJ'), 'the summary never carries a value');
});

test('Hatzi Hinam: the bearer in sessionStorage rides as ss:<name>; a cookie value with = in it survives', () => {
  const got = session(runInPage(captureSessionJs(STORES['hazi-hinam']!), { cookie: 'H_UUID=abc; x=a=b=c', ss: { access_token: 'tok-123456789' }, ls: { cart: 'ignored' } }));
  assert.deepEqual(got.tokens, { 'ss:access_token': 'tok-123456789' });
  assert.equal(got.cookies.find((c) => c.name === 'x')?.value, 'a=b=c');
  assert.equal(got.cookies.find((c) => c.name === 'H_UUID')?.value, 'abc');
});

test('a page whose storage throws still posts, with the error named', () => {
  const posted: string[] = [];
  const window = { ReactNativeWebView: { postMessage: (m: string) => posted.push(m) }, get localStorage(): never { throw new Error('SecurityError: denied'); }, sessionStorage: new FakeStorage() };
  const document = { cookie: 'a=1' };
  new Function('window', 'document', 'navigator', 'location', captureSessionJs(STORES['wolt']!))(window, document, { userAgent: 'lab' }, { href: 'x', hostname: 'h' });
  const got = session(posted);
  assert.equal(got.cookies.length, 1);
  assert.match(String(got.diag.skipped?.[0] ?? got.diag.error), /denied/);
});

test('hasAuthSession: decorative cookies are not a session - only the store\'s own named keys count', () => {
  const rl = STORES['rami-levy']!;
  // Every real page carries analytics/ad cookies whether or not anyone is signed in.
  const decorativeOnly = session(runInPage(captureSessionJs(rl), { cookie: '_ga=GA1.1; AWSALB=x; _gid=y' }));
  assert.equal(hasAuthSession(decorativeOnly, rl.sessionKeys), false, 'decorative cookies alone must not read as a session');
  const withAuthCookie = session(runInPage(captureSessionJs(rl), { cookie: '_ga=GA1.1; auth._token.local=Bearer%20x' }));
  assert.equal(hasAuthSession(withAuthCookie, rl.sessionKeys), true, 'the named cookie is enough, even alone');
  const withAuthToken = session(runInPage(captureSessionJs(rl), { cookie: '_ga=GA1.1', ls: { 'auth._refresh_token.local': 'r1' } }));
  assert.equal(hasAuthSession(withAuthToken, rl.sessionKeys), true, 'the named localStorage key is enough too');
  // A store with no named keys (none defined yet): anything captured counts, same as before this check existed.
  assert.equal(hasAuthSession(decorativeOnly, undefined), true);
  assert.equal(hasAuthSession({ cookies: [], tokens: {}, diag: {} }, undefined), false);
});

test('a malformed report is an empty session with the error named, never a throw', () => {
  const got = parseCapturedSession('{not json');
  assert.deepEqual(got.cookies, []); assert.deepEqual(got.tokens, {}); assert.match(got.diag.error ?? '', /bad session report/);
});

test('the guard, the poll and the guarded wrapper parse; the guard reads a Cloudflare page as a challenge', () => {
  const guard = new Function('document', 'location', `return ${GUARD_JS};`) as (d: unknown, l: unknown) => string;
  assert.equal(guard({ title: 'Just a moment...', body: { innerText: '' }, querySelector: () => null }, { href: 'https://x/' }), 'challenge');
  assert.equal(guard({ title: 'x', body: { innerText: '' }, querySelector: () => null }, { href: 'https://x/cdn-cgi/challenge-platform/' }), 'challenge');
  assert.equal(guard({ title: 'Error 1020', body: { innerText: 'Sorry, you have been blocked' }, querySelector: () => null }, { href: 'https://x/' }), 'blocked');
  assert.equal(guard({ title: 'רמי לוי', body: { innerText: 'שלום' }, querySelector: () => null }, { href: 'https://x/' }), '');
  for (const st of Object.values(STORES)) { new Function(signedInPollJs(st)); new Function(guardedJs(st.openLoginJs ?? '1;')); }
  // A guarded script does not run while a challenge shows, and posts the guard's verdict first.
  const posted = runInPage(guardedJs(`window.ReactNativeWebView.postMessage('ran');`), { title: 'Just a moment...' });
  assert.deepEqual(posted, ['guard:challenge']);
  assert.deepEqual(runInPage(guardedJs(`window.ReactNativeWebView.postMessage('ran');`), { title: 'store' }), ['guard:', 'ran']);
});
