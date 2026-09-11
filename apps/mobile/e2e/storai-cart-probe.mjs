// Watch what a stor.ai chain (Victory) posts to add a line to its cart, so a
// native cart recipe can cover all five stor.ai chains. It searches a real
// product on the live site and clicks its add button, recording only the
// store's own cart requests. Nothing is bought (no checkout).
import { webkit, devices } from 'playwright';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
const p = await ctx.newPage();
const seen = [];
p.on('request', (r) => { const u = r.url(); if (/cart|line|basket|\/v2\/retailers\/\d+\//i.test(u) && r.method() !== 'GET' && !/recaptcha|google|facebook|analytics/i.test(u)) seen.push(`${r.method()} ${u.slice(0,140)}  ${(r.postData()||'').slice(0,160)}`); });
try {
  await p.goto('https://www.victoryonline.co.il/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(5000);
  // Type in the search box and pick the first product, then its + button.
  const box = await p.$('input[type="search"], input[placeholder*="חיפוש"]');
  if (box) { await box.click(); await box.type('חלב', { delay: 60 }); await p.waitForTimeout(3500); }
  // Any "add to cart" plus button on a product tile.
  const added = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /הוסף|add|\+/i.test((x.getAttribute('aria-label')||'')+(x.textContent||'')) && x.getBoundingClientRect().width>0); if (b){ b.click(); return (b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,40);} return null; });
  await p.waitForTimeout(4000);
  console.log('clicked add:', added);
  console.log('cart requests:', seen.length); for (const x of seen) console.log('  ', x);
  await p.screenshot({ path: 'apps/mobile/e2e/shots/storai-victory.png' });
} catch (e) { console.log('err', String(e).slice(0,160)); }
await b.close();
