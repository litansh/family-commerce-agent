/**
 * Store lab: open every store's phone login page in WebKit (the engine inside
 * the app's WebView) with iPhone emulation, run the same scripts the app
 * injects, and report what a person would see. Nothing is submitted.
 *
 *   node --experimental-strip-types e2e/store-lab.mjs [storeId ...]
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(STORES);
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
const rows = [];
for (const id of ids) {
  const s = STORES[id];
  const page = await ctx.newPage();
  const row = { id, url: s.loginUrl };
  try {
    await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);
    // Exactly what the app does after load: open the login, fill the e-mail, twice.
    for (let i = 0; i < 2; i++) {
      if (s.openLoginJs) await page.evaluate(s.openLoginJs).catch(() => null);
      await page.waitForTimeout(1200);
      if (s.prefillEmailJs) await page.evaluate(s.prefillEmailJs('lab@example.com')).catch(() => null);
    }
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return {
        finalUrl: location.href,
        email: q('input[type="email"],input[name*="mail" i],input[name="j_username"]').length,
        password: q('input[type="password"]').length,
        tel: q('input[type="tel"]').length,
        emailValue: (q('input[type="email"],input[name="j_username"]')[0] || {}).value || '',
        otpText: /קוד חד פעמי|שלח קוד|קוד אימות|SMS/.test(text),
        loginText: /כניסה|התחברות/.test(text),
        cookieBanner: /cookies|קובצי cookie/i.test(text),
        head: text.slice(0, 160),
      };
    });
    row.signedIn = await page.evaluate(`(async()=>{try{return await (${s.signedInCheck});}catch(e){return 'ERR '+e.message}})()`);
    Object.assign(row, seen);
    await page.screenshot({ path: `e2e/shots/lab-${id}.png` });
  } catch (e) { row.error = String(e).slice(0, 160); }
  rows.push(row);
  await page.close();
}
await browser.close();
for (const r of rows) {
  const form = r.error ? `ERROR ${r.error}` : `email:${r.email} pw:${r.password} tel:${r.tel} otpText:${r.otpText} prefilled:${r.emailValue ? 'yes' : 'no'} signedIn:${r.signedIn}`;
  console.log(`${r.id.padEnd(16)} ${form}\n${''.padEnd(16)} ${r.finalUrl ?? ''}\n${''.padEnd(16)} ${(r.head ?? '').slice(0, 120)}`);
}
