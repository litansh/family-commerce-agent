import { webkit, devices } from 'playwright';
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
const page = await ctx.newPage();
page.on('request', (r) => { if (r.method() !== 'GET' && !/rami-levy\.co\.il\/api\/(catalog|v2\/cart)/.test(r.url())) r.abort?.(); });
await page.goto('https://www.rami-levy.co.il/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(async () => {
  const lookup = async (body) => { const r = await fetch('/api/catalog?', { method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
  const j = await lookup({ store: 331, items: '7290004131074,7290000208114', itemsBy: 'barcode', size: 2 });
  const rows = j.data || j.items || [];
  const it = rows[0] || {};
  const stockish = Object.fromEntries(Object.entries(it).filter(([k, v]) => /stock|avail|qty|quant|inv|status|active|hide|sale|store|branch|supply|max/i.test(k) && typeof v !== 'object'));
  const nested = Object.fromEntries(Object.entries(it).filter(([k, v]) => v && typeof v === 'object').map(([k, v]) => [k, Array.isArray(v) ? 'array:' + v.length : Object.keys(v).slice(0, 15)]));
  // The store's own per-branch stock check, if the site exposes one: search a term at two branches.
  const q1 = await lookup({ store: 331, q: 'מיץ תפוזים', size: 3 });
  const q2 = await lookup({ store: 500, q: 'מיץ תפוזים', size: 3 });
  const brief = (jj) => (jj.data || []).map((x) => ({ id: x.id, name: x.name, ...Object.fromEntries(Object.entries(x).filter(([k, v]) => /stock|avail|status|active|hide|max/i.test(k) && typeof v !== 'object')) }));
  return { keys: Object.keys(it), stockish, nested, q331: brief(q1), q500: brief(q2) };
});
console.log(JSON.stringify(out, null, 1).slice(0, 3500));
await browser.close();
