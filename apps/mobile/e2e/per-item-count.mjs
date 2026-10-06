/**
 * Can the per-item rung tell the truth? (promise 9, ADR 0010's lowest cart rung.)
 *
 * On that rung the family adds on the store's own product page, tap by tap, and the only evidence
 * an item went in is the store's own basket number rising. The screen reads that number with the
 * store's `basketCountJs` — written for the *cart* page. This lab checks it on the pages the family
 * actually stands on: the store's search results and a product page.
 *
 *   node --experimental-strip-types e2e/per-item-count.mjs [--json out.json] [storeId ...]
 *
 * For each store with a count recipe it reports
 *   load     the page answered
 *   guard    '' | 'challenge' | 'blocked'   (a Cloudflare page is left untouched)
 *   count    the number the store's own page gave back, or '?' when it would not say
 * Nothing is submitted, nothing is added to any cart: the pages are loaded and read, no clicks.
 * Exit 1 when a store with a count recipe cannot be read on its own item pages.
 */
import { webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { STORES } from '../src/lib/stores.ts';

const args = process.argv.slice(2);
const jsonAt = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const stores = (ids.length ? ids : Object.keys(STORES)).filter((id) => STORES[id]?.basketCountJs && STORES[id]?.searchUrl);

const GUARD = `(()=>{try{const t=(document.title+' '+((document.body&&document.body.innerText)||'').slice(0,600));if(/Sorry, you have been blocked|Error 1020|Access denied/i.test(t))return 'blocked';if(document.querySelector('#challenge-form,.cf-turnstile,[id^="cf-chl"]')||/Just a moment|Attention Required|Verify you are human/i.test(t))return 'challenge';}catch(e){}return '';})()`;

const browser = await webkit.launch();
const out = [];
for (const id of stores) {
  const store = STORES[id];
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  // The app's bridge, as the WebView provides it: the recipe posts, we catch.
  await ctx.addInitScript(() => { window.ReactNativeWebView = { postMessage: (m) => { window.__kaniti = String(m); } }; });
  const page = await ctx.newPage();
  const row = { store: id, name: store.name };
  try {
    const res = await page.goto(store.searchUrl('חלב'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    row.load = res?.status() ?? 0;
    await page.waitForTimeout(4000);
    row.guard = await page.evaluate(GUARD);
    if (row.guard) { out.push(row); await ctx.close(); continue; }
    await page.evaluate(store.basketCountJs);
    await page.waitForTimeout(500);
    const msg = await page.evaluate(() => window.__kaniti ?? '');
    row.count = msg.startsWith('basket:') ? msg.slice(7) : `(no answer: ${msg || 'none'})`;
  } catch (e) { row.error = String(e).slice(0, 140); }
  out.push(row);
  await ctx.close();
}
await browser.close();

let bad = 0;
for (const r of out) {
  // A guest basket is legitimately empty: "0" is an answer, "?" is not.
  const ok = !r.error && !r.guard && /^\d+$/.test(r.count ?? '');
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok ' : 'BAD'}  ${r.name.padEnd(14)} load=${r.load ?? '-'} guard=${r.guard || '-'} count=${r.count ?? r.error ?? '-'}`);
}
if (stores.length === 0) console.log('     no store has both a basket-count recipe and a search page yet');
console.log(`${bad === 0 ? 'ok ' : 'BAD'}  the store's own count reads on its item pages — ${stores.length - bad}/${stores.length}`);
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(out, null, 2));
process.exit(bad === 0 ? 0 : 1);
