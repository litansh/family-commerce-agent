// Why does the generic detector say "signed in" on a page? Prints each clause and what it matched.
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const id = process.argv[2] ?? 'tiv-taam'; const s = STORES[id];
const urls = [s.loginUrl, ...(process.argv.slice(3))];
const b = await webkit.launch();
for (const url of urls) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null); await p.waitForTimeout(4000);
  for (let i = 0; i < 2; i++) { if (s.openLoginJs) await p.evaluate(s.openLoginJs).catch(() => null); await p.waitForTimeout(1500); }
  const r = await p.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ');
    const prompt = /(^|\s)(כניסה|כניסת משתמש|התחברות|התחבר|כניסה לחשבון|התחברות לחשבון|הרשמה|log ?in|sign ?in)(\s|$)/i.exec(t)?.[0] || (document.querySelector('input[type="password"]') ? 'password box' : null);
    const logoutEl = document.querySelector('a[href*="logout" i],button[class*="logout" i],[class*="logout" i]');
    const logoutTxt = /(^|\s)(התנתק|התנתקות|יציאה מהחשבון|logout|log out)(\s|$)/i.exec(t)?.[0];
    const greet = /(שלום|היי),?\s+([א-ת]{2,})/.exec(t)?.[0];
    return { href: location.href, prompt, logoutEl: logoutEl ? logoutEl.outerHTML.slice(0, 160) : null, logoutTxt: logoutTxt || null, greet: greet || null, text: t.slice(0, 200) };
  });
  const ok = await p.evaluate(`(async()=>{try{return await (${s.signedInCheck});}catch(e){return 'err '+e.message}})()`);
  console.log(JSON.stringify({ url, signedIn: ok, ...r }, null, 1));
  await ctx.close();
}
await b.close();
