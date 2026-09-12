/**
 * Session-capture lab: the connect screen's own scripts, run in a real WebKit
 * browser (iPhone emulation, this Mac's residential IP) against the live store,
 * with a fake `window.ReactNativeWebView` collecting what they post - exactly
 * what StoreLink's onMessage would receive. Logged out, so it proves the
 * mechanics, not a person's session:
 *
 *   1. the guard reads the page as '' (no Cloudflare step), the poll posts `signedin:0`;
 *   2. the capture posts a `session:` report even now - names only in diag, nothing to hide;
 *   3. a session planted the store's own way (Rami Levy: nuxt-auth's storage, which writes
 *      the cookie and the localStorage key together; others: the store's first sessionKey
 *      as a cookie and a localStorage entry) is in the capture, cookie and token both.
 *
 *   node --experimental-strip-types e2e/session-capture-lab.mjs [rami-levy hazi-hinam ...]
 *
 * Every non-GET request is aborted: nothing is signed in, sent or created.
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
import { captureSessionJs, parseCapturedSession, sessionSummary, signedInPollJs } from '../src/lib/session.ts';
import { guardedJs } from '../src/lib/inject.ts';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['rami-levy', 'hazi-hinam', 'wolt'];
const PLANT = {
  // The site's own auth storage: what a real sign-in writes (verified 2026-09-12: cookie + localStorage, prefix `auth.`).
  'rami-levy': `(()=>{const a=window.$nuxt&&window.$nuxt.$auth;if(!a||!a.$storage)return 'no nuxt auth';a.$storage.setUniversal('_token.local','Bearer LAB-TOKEN-0123456789');a.$storage.setUniversal('_refresh_token.local','LAB-REFRESH-0123456789');return 'nuxt-auth';})()`,
};
const plantGeneric = (key) => `(()=>{localStorage.setItem(${JSON.stringify(key)},'LAB-TOKEN-0123456789');document.cookie=${JSON.stringify(key)}+'=LAB-COOKIE-0123456789; path=/';return 'generic';})()`;

const browser = await webkit.launch();
let bad = 0;
for (const id of ids) {
  const store = STORES[id];
  if (!store) { console.log(`\n== ${id}: unknown store`); bad++; continue; }
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  await ctx.route('**/*', (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  const posted = [];
  await page.exposeFunction('__kanitiPost', (m) => posted.push(String(m)));
  await page.addInitScript(() => { window.ReactNativeWebView = { postMessage: (m) => window.__kanitiPost(m) }; });
  const run = (js) => page.evaluate(js.replace(/;\s*true;\s*$/, ''));
  const last = (prefix) => [...posted].reverse().find((m) => m.startsWith(prefix));
  const fail = (why) => { bad++; console.log(`   FAIL ${why}`); };
  try {
    await page.goto(store.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);
    // 1. the poll, twice, as the screen does every 2.5 s
    for (let i = 0; i < 2; i++) { await run(signedInPollJs(store)); await page.waitForTimeout(1500); }
    const guard = last('guard:'); const signed = last('signedin:');
    console.log(`\n== ${id}  ${guard}  ${signed}`);
    if (guard !== 'guard:') fail(`guard read ${guard} - a challenge or block page; nothing else runs`);
    if (signed !== 'signedin:0') fail(`logged out, yet the poll said ${signed}`);
    // a guarded injection runs (it did not for a day: an invalid regex in the guard)
    await run(guardedJs(`window.ReactNativeWebView.postMessage('probe:{"why":"lab guarded ok"}');`));
    if (!posted.some((m) => m.includes('lab guarded ok'))) fail('a guarded injection did not run');
    // 2. capture, logged out
    posted.length = 0;
    await run(captureSessionJs(store));
    const before = last('session:'); if (!before) { fail('no session: report while logged out'); continue; }
    const s0 = sessionSummary(parseCapturedSession(before.slice(8)));
    console.log(`   logged out: ${s0.cookies} cookies ${s0.tokens} tokens; cookies ${JSON.stringify(s0.cookieNames.slice(0, 8))}; skipped ${JSON.stringify(s0.skipped)}${s0.error ? '; error ' + s0.error : ''}`);
    if (s0.error) fail(`capture error ${s0.error}`);
    // 3. plant a session the store's way, capture again
    const how = await page.evaluate(PLANT[id] ?? plantGeneric(store.sessionKeys?.[0] ?? 'kaniti_token'));
    posted.length = 0;
    await run(captureSessionJs(store));
    const after = last('session:'); if (!after) { fail('no session: report after planting'); continue; }
    const got = parseCapturedSession(after.slice(8)); const s1 = sessionSummary(got);
    const want = (store.sessionKeys ?? []).filter((k) => id === 'rami-levy' ? /_token/.test(k) : true).slice(0, id === 'rami-levy' ? 2 : 1);
    const inCookies = want.filter((k) => got.cookies.some((c) => c.name === k));
    const inTokens = want.filter((k) => k in got.tokens);
    console.log(`   planted (${how}): ${s1.cookies} cookies ${s1.tokens} tokens; wanted ${JSON.stringify(want)} -> in cookies ${JSON.stringify(inCookies)}, in tokens ${JSON.stringify(inTokens)}`);
    if (inCookies.length !== want.length) fail(`planted cookie(s) missing from the capture: ${want.filter((k) => !inCookies.includes(k))}`);
    if (inTokens.length !== want.length) fail(`planted localStorage key(s) missing from the capture: ${want.filter((k) => !inTokens.includes(k))}`);
    if (JSON.stringify(s1).includes('LAB-TOKEN')) fail('the summary carries a value');
    if (!JSON.stringify(got).includes('LAB-TOKEN')) fail('the planted value is not in the report');
    // What the API would say: the counts it logs and whether it would keep the row.
    console.log(`   API would log store-session cookies=${s1.cookies} tokens=${s1.tokens} -> ${s1.cookies + s1.tokens ? 'connected' : '400 no session in body'}`);
  } catch (e) { fail(String(e).slice(0, 160)); }
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad} failure(s)` : '\nsession capture: every store posts, and a planted session is captured');
process.exit(bad ? 1 : 0);
