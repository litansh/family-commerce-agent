/**
 * Store health: what a person on a phone would meet at every store right now.
 *
 * For each store, in WebKit with iPhone emulation on this network: load the
 * login page, run exactly what the app injects (open login, prefill), and report
 *   load       the page answered (HTTP status of the main document)
 *   guard      '' | 'challenge' | 'blocked'  (Cloudflare in front of the store)
 *   login      the store's own sign-in is on screen (e-mail/phone/password box or code step)
 *   detector   the app's signed-in check says NOT signed in (no false "connected")
 *   signup     the sign-up form exists and the filler finds fields (where the store has one)
 * Nothing is submitted; no SMS, e-mail or account is ever created.
 *
 *   node --experimental-strip-types e2e/store-health.mjs [--json out.json] [storeId ...]
 * Exit 1 when any store is unhealthy.
 */
import { webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { STORES, signupFillJs } from '../src/lib/stores.ts';

const args = process.argv.slice(2);
const jsonAt = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const stores = ids.length ? ids : Object.keys(STORES);

const GUARD = `(()=>{try{const t=(document.title+' '+((document.body&&document.body.innerText)||'').slice(0,600));if(/Sorry, you have been blocked|Error 1020|Access denied|has been blocked/i.test(t))return 'blocked';if(document.querySelector('#challenge-form,#challenge-running,#challenge-stage,.cf-turnstile,[id^="cf-chl"],iframe[src*="challenges.cloudflare.com"]')||/cdn-cgi\\/challenge/.test(location.href)||/Just a moment|Attention Required|Verify you are human|Checking your browser/i.test(t))return 'challenge';}catch(e){}return '';})()`;
const LOGIN_UI = `(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const q=[...document.querySelectorAll('input[type="email"],input[type="tel"],input[type="password"],input[autocomplete="one-time-code"],input[name*="phone" i],input[name*="mail" i],input[placeholder*="טלפון"],input[placeholder*="מייל"]')].filter(vis);return q.length;})()`;

const browser = await webkit.launch();
const rows = [];
for (const id of stores) {
  const s = STORES[id];
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const row = { id, name: s.name, url: s.loginUrl, load: 0, guard: '', login: false, detector: null, signup: null, ok: false, note: '' };
  try {
    const res = await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    row.load = res ? res.status() : 0;
    await page.waitForTimeout(3500);
    row.guard = await page.evaluate(GUARD).catch(() => '');
    if (!row.guard) {
      for (let i = 0; i < 2; i++) {
        if (s.openLoginJs) await page.evaluate(s.openLoginJs).catch(() => null);
        await page.waitForTimeout(1200);
        if (s.prefillEmailJs) await page.evaluate(s.prefillEmailJs('lab@example.com')).catch(() => null);
      }
      await page.waitForTimeout(1500);
      row.login = (await page.evaluate(LOGIN_UI).catch(() => 0)) > 0;
      const r = await page.evaluate(`(async()=>{try{return await (${s.signedInCheck});}catch(e){return 'err:'+e.message}})()`).catch((e) => 'err:' + e.message);
      row.detector = r === false ? 'logged-out' : r === true ? 'FALSE-POSITIVE' : String(r);
      if (s.signup?.url) {
        const p2 = await ctx.newPage();
        try {
          await p2.goto(s.signup.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await p2.waitForTimeout(3000);
          for (let i = 0; i < 2; i++) { if (s.openLoginJs) await p2.evaluate(s.openLoginJs).catch(() => null); await p2.waitForTimeout(1000); }
          await p2.evaluate(signupFillJs({ email: 'lab@example.com', lastName: 'לאב', street: 'ביאליק', number: '20', city: 'רמת גן' })).catch(() => null);
          await p2.waitForTimeout(800);
          const filled = await p2.evaluate(() => [...document.querySelectorAll('input')].filter((i) => i.value && /lab@example|לאב|ביאליק|רמת גן|20/.test(i.value)).length).catch(() => 0);
          row.signup = filled;
        } catch (e) { row.signup = 'err:' + String(e).slice(0, 60); }
        await p2.close();
      }
    }
    row.ok = row.load > 0 && row.load < 400 && !row.guard && row.login && row.detector === 'logged-out';
    if (!row.ok) row.note = row.guard ? `cloudflare ${row.guard}` : row.load >= 400 || row.load === 0 ? `http ${row.load}` : !row.login ? 'no sign-in on screen' : row.detector !== 'logged-out' ? `detector ${row.detector}` : '';
  } catch (e) { row.note = String(e).slice(0, 120); }
  rows.push(row);
  console.log(`${(row.ok ? 'ok ' : 'BAD').padEnd(4)} ${id.padEnd(16)} load=${row.load} guard=${row.guard || '-'} login=${row.login} detector=${row.detector} signup=${row.signup ?? '-'} ${row.note}`);
  await ctx.close();
}
await browser.close();
const bad = rows.filter((r) => !r.ok);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
console.log(bad.length ? `\n${bad.length} unhealthy: ${bad.map((r) => r.id).join(', ')}` : '\nall stores healthy');
process.exit(bad.length ? 1 : 0);
