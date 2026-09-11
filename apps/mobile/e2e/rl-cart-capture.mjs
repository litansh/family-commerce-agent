// Ground truth: open one product's page on Rami Levy (guest), press its add button,
// and record every non-GET request the site sends to its own hosts.
import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const seen = []; let arm = false;
p.on('response', async (res) => { const r = res.request(); const u = r.url(); if (!arm || !/rami-levy\.co\.il/.test(u) || r.method() === 'GET' || /catalog\?|cdn-cgi|rum/.test(u)) return; let body=''; try { body = (await res.text()).slice(0, 300); } catch {} const h = r.headers(); seen.push({ m: r.method(), u: u.slice(0, 160), status: res.status(), req: (r.postData() || '').slice(0, 300), hdr: Object.fromEntries(Object.entries(h).filter(([k]) => /auth|ecom|token|content-type|^x-/i.test(k)).map(([k,v]) => [k, String(v).slice(0, 70)])), res: body }); });
await p.goto('https://www.rami-levy.co.il/he/online/search?item=7290000056845', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(6000);
const info = await p.evaluate(() => { const vis = (x) => x.getBoundingClientRect().width > 0; const all = [...document.querySelectorAll('button,[role="button"]')].filter(vis); return all.map(x => ((x.getAttribute('aria-label') || '') + '|' + (x.textContent || '').trim().slice(0, 20) + '|' + (x.className || '').toString().slice(0, 40))).slice(0, 40); });
console.log('buttons:', JSON.stringify(info));
arm = true;
const clicked = await p.evaluate(() => { const vis = (x) => x.getBoundingClientRect().width > 0; const all = [...document.querySelectorAll('button,[role="button"]')].filter(vis); const b = all.find(x => /add|plus|הוסף|הוספה/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.className || '')) || (x.textContent || '').trim() === '+'); if (b) { b.click(); return ((b.getAttribute('aria-label') || '') + '|' + (b.textContent || '').trim().slice(0, 20) + '|' + (b.className || '').toString().slice(0, 50)); } return null; });
await p.waitForTimeout(7000);
console.log('clicked:', clicked); console.log('requests after click:', seen.length);
for (const s of seen) console.log(JSON.stringify(s).slice(0, 700));
await p.screenshot({ path: 'e2e/shots/rl-cart-capture.png' }); await b.close();
