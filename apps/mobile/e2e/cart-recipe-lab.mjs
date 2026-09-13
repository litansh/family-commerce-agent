/**
 * Cart-recipe lab: run a store's on-device cart recipe (STORES[id].cartJs) in a
 * real WebKit browser against the live site - the same engine as the app's
 * WebView, on this Mac's residential IP, so Cloudflare clears it exactly as it
 * does for a person. No login: this proves the guest-cart path where a store
 * has one (Rami Levy), and reports honestly where a store needs a session
 * (Shufersal → its own login).
 *
 *   node --experimental-strip-types e2e/cart-recipe-lab.mjs [rami-levy shufersal]
 *
 * It adds a couple of real barcodes and prints what the store's own cart did.
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';

const FAKE_GTIN = '9999999999999'; // deliberately absent — must never resolve to a real product
const BASKET = [
  { gtin: '7290001794852', name: 'חלב טרי 3%', qty: 2 },     // milk - the guest default branch's own private label, not a chain brand that branch may not carry
  { gtin: '7290000208114', name: 'אפונת גינה יכין', qty: 1 }, // canned peas
  { gtin: FAKE_GTIN, name: 'לא קיים', qty: 1 },               // deliberately absent
];

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['rami-levy'];
const browser = await webkit.launch();
for (const id of ids) {
  const store = STORES[id];
  if (!store?.cartJs) { console.log(`\n== ${id}: no cart recipe`); continue; }
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (/cart|error|token|catalog/i.test(t)) console.log('   [console]', t.slice(0, 200)); });
  // Capture what the recipe posts back (the app's WebView bridge).
  let resolveGot; const got = new Promise((r) => { resolveGot = r; });
  await page.exposeFunction('__cartResult', (payload) => resolveGot(payload));
  await page.addInitScript(() => {
    // @ts-ignore
    window.ReactNativeWebView = { postMessage: (m) => { try { if (String(m).startsWith('cart:')) window.__cartResult(JSON.parse(String(m).slice(5))); } catch (e) {} } };
  });
  try {
    await page.goto(store.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000); // let the store's app boot (its axios/session/store id)
    // The recipe is an async IIFE; drop its trailing `;true;` so it is a bare
    // expression, then evaluate it in the page (Playwright bypasses CSP, like the
    // WebView's injectJavaScript does) and await the promise it returns.
    await page.evaluate(store.cartJs(BASKET).replace(/;\s*true;\s*$/, ''));
    const res = await Promise.race([got, new Promise((r) => setTimeout(() => r({ timeout: true }), 30_000))]);
    const counts = (res.results || []).reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
    console.log(`\n== ${id}  ${JSON.stringify(counts)}  diag: ${JSON.stringify(res.diag || res)}`);
    for (const r of res.results || []) console.log(`   ${r.status.padEnd(7)} ${r.gtin || ''} ${r.detail || ''}`);
    // Promise 9: a claim of "added" is only true if it is the product the family asked for.
    const fakeAdded = (res.results || []).find((r) => r.gtin === FAKE_GTIN && r.status === 'added');
    if (fakeAdded) console.log(`   PROMISE9-VIOLATION: the deliberately absent barcode ${FAKE_GTIN} was added as "${fakeAdded.detail}" — the store's cart holds a product the family never asked for`);
    // Read the store's own cart back (its own basketCountJs, the same recipe the phone runs on
    // the cart page), to confirm the lines really landed - not just that the recipe said so.
    if (store.basketCountJs && store.cartUrl) {
      let resolveBadge; const gotBadge = new Promise((r) => { resolveBadge = r; });
      await page.exposeFunction('__basketResult', (m) => resolveBadge(m));
      await page.goto(store.cartUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(5000);
      await page.evaluate(() => { window.__origPost = window.ReactNativeWebView.postMessage; window.ReactNativeWebView.postMessage = (m) => { if (String(m).startsWith('basket:')) window.__basketResult(String(m).slice(7)); else window.__origPost(m); }; });
      await page.evaluate(store.basketCountJs.replace(/;\s*true;\s*$/, ''));
      const badge = await Promise.race([gotBadge, new Promise((r) => setTimeout(() => r('?'), 15_000))]);
      console.log(`   basket page count: ${badge}`);
      if (badge !== '?' && Number(badge) !== (counts.added || 0)) console.log(`   PROMISE9-VIOLATION: ${counts.added || 0} claimed added but the store's own basket shows ${badge}`);
    }
    await page.screenshot({ path: `e2e/shots/cart-${id}.png` });
  } catch (e) { console.log(`\n== ${id}: ${String(e).slice(0, 160)}`); }
  await ctx.close();
}
await browser.close();
