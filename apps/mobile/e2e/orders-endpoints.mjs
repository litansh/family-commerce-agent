// Find Rami Levy's order-history endpoints in its web app bundles (no login needed to read the code).
import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const scripts = new Set();
p.on('response', (r) => { if (r.request().resourceType() === 'script') scripts.add(r.url()); });
const site = process.argv[2] || 'https://www.rami-levy.co.il/he/online/market';
await p.goto(site, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
await p.waitForTimeout(3000);
const hits = new Map();
for (const u of scripts) {
  const t = await (await fetch(u)).text().catch(() => '');
  for (const m of t.matchAll(/["'`](\/?api\/v\d[^"'`]{0,80}(order|history|purchase)[^"'`]{0,60})["'`]/gi)) hits.set(m[1], (hits.get(m[1]) || 0) + 1);
  for (const m of t.matchAll(/(getOrders|ordersHistory|orderHistory|myOrders|getMyOrders|lastOrders|my-orders|orders\/history|users\/[^"'`]{0,30}orders)[^;{]{0,120}/g)) hits.set('fn:' + m[0].slice(0, 160), 1);
}
console.log('scripts', scripts.size); for (const [k] of hits) console.log(k);
await b.close();
