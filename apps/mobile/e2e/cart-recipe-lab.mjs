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
 *
 * Both real barcodes are shelf-stable dry goods, not dairy: a branch's fresh-milk stock
 * turns over daily and made this basket flaky (2026-09-13, milk absent from branch 331's
 * own `available_in` — a real, honest `unavailable` from the recipe, not a bug in it; see
 * `e2e/rl-stock-probe.mjs`). The recipe already reports a branch shortfall correctly
 * (promise 9); it is this lab's fixed pair that needs to survive one item's stock, not
 * the recipe.
 *
 * 2026-10-10: the instant coffee (7290000072753) dropped out of branch 331's own `available_in`
 * (25 branches, 412 among them, 331 not) — the third stock-out of a lab item since 2026-09-13.
 * So the basket now has three real lines for a check that needs two: staples the store lists at
 * (nearly) every branch, the store's own brand first, and a spare so one branch stock-out still
 * leaves the 2 verified adds the check demands. A stock-out is printed (and the check's summary
 * says it), never hidden; two at once still turn the check red. Before swapping an item, ask the
 * store: `node e2e/rl-stock-probe.mjs --store 331 <barcode>...`.
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';

const FAKE_GTIN = '9999999999999'; // deliberately absent — must never resolve to a real product
const BASKET = [
  { gtin: '7290113460607', name: 'סוכר לבן רמי לוי', qty: 2 }, // the store's own white sugar 1 kg - listed at 26 branches, 331 among them (2026-10-10); replaces the coffee 7290000072753, out at 331
  { gtin: '7290000208114', name: 'אפונת גינה יכין', qty: 1 }, // canned peas - 24 branches, 331 among them
  { gtin: '7290000211442', name: 'אורז פרסי סוגת', qty: 1 },  // spare: Sugat rice 1 kg - 26 branches, 331 among them; one stock-out above still leaves 2 verified adds
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
  // The store's own cart answers, so an empty basket page can be told apart from a cart the store never held.
  const answers = [];
  page.on('response', async (r) => { if (/\/api\/v2\/cart(\?|$)/.test(r.url())) { try { const j = await r.json(); const arr = j.items || (j.data && j.data.items) || []; answers.push(`${r.status()}:${Array.isArray(arr) ? arr.length : '?'}`); } catch (e) { answers.push(`${r.status()}:?`); } } });
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
      await page.goto(store.cartUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // The store's basket page paints an empty cart before it syncs (a single read at 5 s once said 0
      // for a cart that held the lines, 2026-10-06). Read its own count every second until two equal
      // non-zero readings, or 25 s; every reading is printed so an early 0 is never mistaken for proof.
      let latest = '?'; await page.exposeFunction('__basketResult', (m) => { latest = m; });
      await page.evaluate(() => { window.__origPost = window.ReactNativeWebView.postMessage; window.ReactNativeWebView.postMessage = (m) => { if (String(m).startsWith('basket:')) window.__basketResult(String(m).slice(7)); else window.__origPost(m); }; });
      const readings = []; let badge = '?';
      for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); latest = '?'; await page.evaluate(store.basketCountJs.replace(/;\s*true;\s*$/, '')).catch(() => null); await page.waitForTimeout(150); readings.push(latest); if (latest !== '?' && latest !== '0' && latest === badge) break; badge = latest; }
      badge = readings[readings.length - 1] ?? '?';
      console.log(`   basket page count: ${badge}  (readings ${readings.join(',')})`);
      if (badge === '0' || badge === '?') console.log(`   store cart answers ${answers.join(' ') || 'none'}; persisted cart ${await page.evaluate(() => { try { const v = JSON.parse(localStorage.getItem('ramilevy') || 'null'); return v && v.cart && Array.isArray(v.cart.items) ? v.cart.items.length + ' items' : 'none'; } catch (e) { return 'unreadable'; } }).catch(() => '?')}; url ${page.url()}`);
      if (badge !== '?' && Number(badge) !== (counts.added || 0)) console.log(`   PROMISE9-VIOLATION: ${counts.added || 0} claimed added but the store's own basket shows ${badge}`);
    }
    await page.screenshot({ path: `e2e/shots/cart-${id}.png` });
  } catch (e) { console.log(`\n== ${id}: ${String(e).slice(0, 160)}`); }
  await ctx.close();
}
await browser.close();
