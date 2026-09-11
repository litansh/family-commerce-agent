// What does Victory answer when a phone asks for an SMS code? Records every 4xx/5xx the page's own calls get.
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const s = STORES['victory'];
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const bad = [];
p.on('request', (q) => { if (q.method() === 'POST' && !/google|analytics|syndication/.test(q.url())) console.log('POST', q.url().slice(0, 120), (q.postData() || '').slice(0, 200)); });
p.on('response', async (r) => { const u = r.url(); if (/\/v2\/|sessions|login|otp|sms/i.test(u)) { let body = ''; if (r.status() >= 400) { try { body = (await r.text()).replace(/\s+/g, ' ').slice(0, 160); } catch {} } bad.push(`${r.status()} ${r.request().method()} ${u.slice(0, 110)} ${body}`); } });
await p.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4000);
for (let i = 0; i < 2; i++) { await p.evaluate(s.openLoginJs).catch(() => null); await p.waitForTimeout(1500); }
console.log('url', p.url());
const tel = p.locator('input[type="tel"], input[name*="phone" i], input[placeholder*="טלפון"]').first();
if (await tel.count()) {
  await tel.fill('0500000000');
  const btn = p.locator('button:has-text("שלח קוד"), button:has-text("שלח")').first();
  console.log('send button:', await btn.count());
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(6000); }
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const i = txt.search(/403|שגיאה|error|לא ניתן|לא תקין/i); console.log('page says:', i >= 0 ? txt.slice(Math.max(0, i - 80), i + 120) : '(no error text)');
  console.log('form area:', txt.slice(txt.indexOf('מספר טלפון'), txt.indexOf('מספר טלפון') + 200));
} else console.log('no phone box; body:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300));
console.log('4xx/5xx:', bad.length ? bad.join('\n  ') : 'none');
await p.screenshot({ path: 'e2e/shots/victory-403.png' });
await b.close();
