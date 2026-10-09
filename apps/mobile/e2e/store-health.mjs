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

// One store's budget. Alone the whole lab takes ~140 s; in the daily run, beside the other browser
// checks, one page stopped answering (page.evaluate has no timeout of its own) and the loop sat on it
// until check.mjs killed the lab at 600 s, losing every row after it (2026-10-06, after shufersal).
// A store that does not reach a verdict in this time gets its own row saying so, and the run goes on.
const STORE_BUDGET_MS = 120_000;
const within = (ms, p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);

// Sleep, not the store (2026-10-09): with the lid closed on battery the ops Mac sleeps, wakes for ~45 s
// (DarkWake) and sleeps again, even under `caffeinate -i`. A store whose page was open across a sleep
// reported "no verdict in 120 s (stuck at load)" after ~1000 s of wall time, and the run took 20-27 min
// against check.mjs's 600 s. Node's clocks (Date, performance, hrtime) all count the time asleep, so
// sleep is measured as the gaps in a 1 s heartbeat that never ran. Each row and the run say how long
// the machine was asleep, so a sleeping Mac is not read as a changed store. What counts as ok is unchanged.
let asleepMs = 0, lastBeat = Date.now();
setInterval(() => { const now = Date.now(); if (now - lastBeat > 5_000) asleepMs += now - lastBeat - 1_000; lastBeat = now; }, 1_000).unref();
const clocks = () => ({ wall: Date.now(), asleep: asleepMs });
const asleepS = (c0) => Math.round((asleepMs + (Date.now() - lastBeat > 5_000 ? Date.now() - lastBeat - 1_000 : 0) - c0.asleep) / 1000);
const run0 = clocks();
const browser = await webkit.launch();
const rows = [];
async function checkStore(id) {
  const s = STORES[id];
  const c0 = clocks();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const row = { id, name: s.name, url: s.loginUrl, load: 0, guard: '', login: false, detector: null, signup: null, ok: false, note: '' };
  let stage = 'load';
  try { await within(STORE_BUDGET_MS, (async () => {
    const res = await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    row.load = res ? res.status() : 0;
    await page.waitForTimeout(3500);
    stage = 'guard';
    row.guard = await page.evaluate(GUARD).catch(() => '');
    if (!row.guard) {
      // Open the sign-in the way the app does, and look for it until it shows (up to 6 tries, ~16 s).
      // One look at a fixed ~5 s missed Wolt's dialog when the Mac was busy with the other checks
      // ("no sign-in on screen" in the daily run, ok 3/3 alone, 2026-10-06).
      stage = 'login';
      for (let i = 0; i < 6 && !row.login; i++) {
        if (s.openLoginJs) await page.evaluate(s.openLoginJs).catch(() => null);
        await page.waitForTimeout(1200);
        if (s.prefillEmailJs) await page.evaluate(s.prefillEmailJs('lab@example.com')).catch(() => null);
        await page.waitForTimeout(i < 1 ? 1500 : 800);
        row.login = (await page.evaluate(LOGIN_UI).catch(() => 0)) > 0;
      }
      stage = 'detector';
      const r = await within(20_000, page.evaluate(`(async()=>{try{return await (${s.signedInCheck});}catch(e){return 'err:'+e.message}})()`), 'no answer in 20 s').catch((e) => 'err:' + e.message);
      row.detector = r === false ? 'logged-out' : r === true ? 'FALSE-POSITIVE' : String(r);
      if (s.signup?.url) {
        stage = 'signup';
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
  })(), 'store budget'); } catch (e) { row.ok = false; row.note = /store budget/.test(String(e)) ? `no verdict in ${STORE_BUDGET_MS / 1000} s (stuck at ${stage})` : String(e).slice(0, 120); }
  row.asleepS = asleepS(c0);
  if (row.asleepS >= 30) row.note = `${row.note ? row.note + '; ' : ''}machine asleep ${row.asleepS} s during this store (not the store)`.trim();
  await within(10_000, ctx.close(), 'close').catch(() => null);
  return row;
}
// A store that failed while the machine slept gets one fresh look under the same rule; a failure
// with the Mac awake stands as it is. Both attempts are in the JSON.
for (const id of stores) {
  let row = await checkStore(id);
  if (!row.ok && row.asleepS >= 30) { const first = row; row = await checkStore(id); row.firstTry = first; if (row.ok) row.note = `ok on a second look (first: ${first.note})`; }
  rows.push(row);
  console.log(`${(row.ok ? 'ok ' : 'BAD').padEnd(4)} ${id.padEnd(16)} load=${row.load} guard=${row.guard || '-'} login=${row.login} detector=${row.detector} signup=${row.signup ?? '-'} ${row.note}`);
}
await within(15_000, browser.close(), 'close').catch(() => null);
const bad = rows.filter((r) => !r.ok);
const wallS = Math.round((Date.now() - run0.wall) / 1000), sleptS = asleepS(run0);
console.log(`\nwall ${wallS} s${sleptS >= 30 ? `, machine asleep ${sleptS} s of it (lid closed / idle sleep: rerun awake, the stores are not the cause)` : ''}`);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify({ at: new Date().toISOString(), wallS, asleepS: sleptS, rows }, null, 1));
console.log(bad.length ? `\n${bad.length} unhealthy: ${bad.map((r) => r.id).join(', ')}` : '\nall stores healthy');
process.exit(bad.length ? 1 : 0);
