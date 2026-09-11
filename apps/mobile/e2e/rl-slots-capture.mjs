// What Rami Levy's basket/checkout asks for delivery slots (guest): the supply-date and
// delivery-times calls, their bodies and answers.
import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const seen = [];
p.on('response', async (res) => { const r = res.request(); const u = r.url(); if (!/rami-levy\.co\.il/.test(u) || !/supply|deliver|slot|times|checkout|basket/i.test(u) || /\.(js|css|png|svg|woff)/.test(u)) return; let body=''; try { body=(await res.text()).slice(0,700); } catch {} seen.push({ m: r.method(), u: u.slice(0,150), status: res.status(), req: (r.postData()||'').slice(0,250), res: body }); });
await p.goto('https://www.rami-levy.co.il/he/online/search?item=7290004131074', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(5000);
await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>/^הוסף/.test(x.getAttribute('aria-label')||'')&&x.getBoundingClientRect().width>0); b&&b.click(); }); await p.waitForTimeout(4000);
await p.goto('https://www.rami-levy.co.il/he/basket', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(6000);
console.log('basket text:', (await p.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0,300))));
await p.goto('https://www.rami-levy.co.il/he/dashboard/checkout', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>null); await p.waitForTimeout(6000);
console.log('checkout text:', (await p.evaluate(() => (document.body.innerText||'').replace(/\s+/g,' ').slice(0,300))));
console.log('\nslot-related calls:', seen.length); for (const s of seen) console.log(JSON.stringify(s).slice(0,900));
await p.screenshot({ path: 'e2e/shots/rl-slots.png' }); await b.close();
