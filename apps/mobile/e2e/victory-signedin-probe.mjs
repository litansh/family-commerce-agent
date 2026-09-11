// Why does the generic signed-in check say "in" on Victory's logged-out phone page?
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
await p.goto(STORES.victory.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4000);
for (let i = 0; i < 2; i++) { await p.evaluate(STORES.victory.openLoginJs).catch(() => null); await p.waitForTimeout(1200); }
const r = await p.evaluate(`(async()=>{ const h=((document.querySelector('header')||document.body).innerText||'').slice(0,800); const out=/התנתק|יציאה מהחשבון|החשבון שלי|שלום[, ]|logout/i.test(h)||!!document.querySelector('a[href*="logout" i],button[class*="logout" i]'); const inn=/(^|\\s)(כניסה|התחברות|כניסה לחשבון)(\\s|$)/.test(h); const check = await (${STORES.victory.signedInCheck}); return { check, out, inn, header: h.replace(/\\s+/g,' ').slice(0,300), logoutEl: !!document.querySelector('a[href*="logout" i],button[class*="logout" i]'), hasHeaderTag: !!document.querySelector('header'), cookies: document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(Boolean).slice(0,20), ls: Object.keys(localStorage).slice(0,25) }; })()`);
console.log(JSON.stringify(r, null, 1));
await p.screenshot({ path: 'e2e/shots/victory-loggedout.png' }); await b.close();
