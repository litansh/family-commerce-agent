/**
 * Rami Levy stock probe: what the store's own catalogue says about a barcode at a branch -
 * the same `/api/catalog` answer (and its `available_in` branch list) the cart recipe reads,
 * so an 'unavailable' from the recipe can be checked against the store, not the recipe.
 * Read-only: the catalogue lookup is a POST that only reads; every other non-GET is aborted.
 *
 *   node e2e/rl-stock-probe.mjs [--store 331] [--q "<search words>"] <barcode>...
 */
import { webkit, devices } from 'playwright';
const argv = process.argv.slice(2);
let store = 331; const qs = []; const codes = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--store') store = Number(argv[++i]); else if (argv[i] === '--q') qs.push(argv[++i]); else codes.push(argv[i]); }
if (!codes.length && !qs.length) codes.push('7290000072753', '7290000208114');
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
const page = await ctx.newPage();
await page.route('**/*', (r) => (r.request().method() === 'GET' || /rami-levy\.co\.il\/api\/catalog/.test(r.request().url()) ? r.continue() : r.abort()));
await page.goto('https://www.rami-levy.co.il/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(async ({ store, codes, qs }) => {
  const lookup = async (body) => { const r = await fetch('/api/catalog?', { method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const brief = (x) => ({ id: x.id, barcode: x.barcode, name: x.name, atStore: Array.isArray(x.available_in) ? x.available_in.includes(store) : 'no list', branches: Array.isArray(x.available_in) ? x.available_in.length : null, price: x.price && (x.price.price ?? x.price) });
  const res = {};
  if (codes.length) { const a = await lookup({ store, items: codes.join(','), itemsBy: 'barcode', size: codes.length }); res.byBarcodeAtStore = { status: a.status, rows: (a.j.data || []).map(brief) }; const b = await lookup({ items: codes.join(','), itemsBy: 'barcode', size: codes.length }); res.byBarcodeNoStore = { status: b.status, rows: (b.j.data || []).map(brief) }; }
  for (const q of qs) { const s = await lookup({ store, q, size: 12 }); res['q:' + q] = { status: s.status, rows: (s.j.data || []).map(brief) }; }
  return res;
}, { store, codes, qs });
console.log(JSON.stringify({ store, at: new Date().toISOString(), ...out }, null, 1));
await browser.close();
