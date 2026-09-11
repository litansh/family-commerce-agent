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

const BASKET = [
  { gtin: '7290004131074', name: 'חלב תנובה 3%', qty: 2 },   // milk
  { gtin: '7290000208114', name: 'אפונת גינה יכין', qty: 1 }, // canned peas
  { gtin: '9999999999999', name: 'לא קיים', qty: 1 },         // deliberately absent
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
    // Read the store's own cart back, to confirm the lines really landed.
    if (id === 'rami-levy') {
      const n = await page.evaluate(async () => { try { const nx = window.$nuxt; const c = nx && nx.$store && nx.$store.getters['cart/getCartItems']; const items = (nx && nx.$store && nx.$store.state && nx.$store.state.cart && nx.$store.state.cart.items) || null; return items ? items.length : 'no cart state'; } catch (e) { return 'err ' + e.message; } });
      console.log(`   store cart state holds: ${n}`);
      await page.goto('https://www.rami-levy.co.il/he/basket', { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(5000);
      const badge = await page.evaluate(() => { const t=(document.body.innerText||'').replace(/\s+/g,' '); const m=t.match(/(\d+)\s*הסל שלי/); return m?m[1]:'?'; });
      console.log(`   basket page count: ${badge}`);
    }
    await page.screenshot({ path: `e2e/shots/cart-${id}.png` });
  } catch (e) { console.log(`\n== ${id}: ${String(e).slice(0, 160)}`); }
  await ctx.close();
}
await browser.close();
