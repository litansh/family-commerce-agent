// Before/after: main's guarded poll vs this branch's, in WebKit on the real Rami Levy page.
import { webkit, devices } from 'playwright';
import fs from 'node:fs';
import { STORES } from '../../src/lib/stores.ts';
import { signedInPollJs } from '../../src/lib/session.ts';
const src = fs.readFileSync(new URL('./StoreLink.main.txt', import.meta.url), 'utf8');
const GUARD_MAIN = eval('`' + src.match(/const GUARD_TEST = `([^`]*)`/)[1] + '`');
const store = STORES['rami-levy'];
const pollMain = `(async()=>{try{const g=${GUARD_MAIN};window.ReactNativeWebView.postMessage('guard:'+g);if(g)return;if(document.querySelector('input[autocomplete="one-time-code"]')){window.ReactNativeWebView.postMessage('signedin:0');return;}const ok=await (${store.signedInCheck});window.ReactNativeWebView.postMessage('signedin:'+(ok?'1':'0'));}catch(e){window.ReactNativeWebView.postMessage('signedin:0');}})();true;`;
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const posted = []; await p.exposeFunction('__post', (m) => posted.push(m));
await p.addInitScript(() => { window.ReactNativeWebView = { postMessage: (m) => window.__post(m) }; });
await p.goto(store.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3000);
// injectJavaScript evaluates the string as a script: a syntax error is swallowed by the WebView. Emulate with addScriptTag.
for (const [label, js] of [['main', pollMain], ['branch', signedInPollJs(store)]]) {
  posted.length = 0; let err = '';
  p.once('pageerror', (e) => { err = String(e).slice(0, 80); });
  await p.addScriptTag({ content: js }).catch((e) => { err = err || String(e).slice(0, 80); });
  await p.waitForTimeout(1500);
  console.log(`${label.padEnd(7)} posted=${JSON.stringify(posted)} ${err ? 'error: ' + err : ''}`);
}
await b.close();
