// Does the OTP tuner find and focus each store's code box on the phone? Nothing is submitted.
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
import fs from 'node:fs';
const OTP = fs.readFileSync('/tmp/otp.js', 'utf8');
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
for (const id of ['rami-levy', 'victory', 'wolt']) {
  const s = STORES[id]; const p = await ctx.newPage();
  try {
    await p.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3500);
    for (let k = 0; k < 2; k++) { if (s.openLoginJs) await p.evaluate(s.openLoginJs).catch(() => null); await p.waitForTimeout(1200); if (s.prefillEmailJs) await p.evaluate(s.prefillEmailJs('lab@example.com')).catch(() => null); }
    await p.evaluate(OTP);
    // Nudge to the code step where it is a separate tap (Victory's SMS tab exists but needs a phone; Rami Levy needs an e-mail submit). Just report what is on screen.
    await p.waitForTimeout(800);
    const seen = await p.evaluate(() => ({ url: location.pathname, inputs: [...document.querySelectorAll('input')].filter(i => i.getBoundingClientRect().width > 0 && i.type !== 'hidden').map(i => ({ type: i.type, id: i.id || i.name || i.placeholder, ac: i.getAttribute('autocomplete'), im: i.getAttribute('inputmode'), ml: i.getAttribute('maxlength'), focused: document.activeElement === i })) }));
    console.log(id.padEnd(12), JSON.stringify(seen));
  } catch (e) { console.log(id, 'ERR', String(e).slice(0, 100)); }
  await p.close();
}
await b.close();
