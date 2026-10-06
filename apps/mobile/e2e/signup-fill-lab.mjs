// Run the sign-up filler on real registration pages (nothing is submitted; every non-GET aborted).
import { webkit, devices } from 'playwright';
import { STORES, signupFillJs } from '../src/lib/stores.ts';
const known = { email: 'lab@example.com', lastName: 'ישראלי', street: 'הרצל', number: '1', city: 'תל אביב', apt: '1', floor: '1', entrance: 'א' };
const b = await webkit.launch();
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['shufersal', 'hazi-hinam', 'rami-levy', 'victory']) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage(); let got = null;
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()));
  await p.exposeFunction('__probe', (o) => { got = o; });
  await p.addInitScript(() => { window.ReactNativeWebView = { postMessage: (m) => { try { if (String(m).startsWith('probe:')) window.__probe(JSON.parse(String(m).slice(6))); } catch (e) {} } }; });
  try {
    await p.goto(STORES[id].signup.url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3500);
    // stor.ai / Rami Levy open the register tab from the login dialog
    await p.evaluate(() => { const b = [...document.querySelectorAll('a,button,[role="tab"]')].find(x => /^\s*(הרשמה|הירשם|משתמש חדש|לקוח חדש|צור חשבון|יצירת חשבון|הרשמה זאת פעם ראשונה)/.test((x.textContent||'').trim()) && x.getBoundingClientRect().width>0); b && b.click(); }).catch(() => null); await p.waitForTimeout(2500);
    await p.evaluate(signupFillJs(known).replace(/;\s*true;\s*$/, ''));
    await p.waitForTimeout(800);
    const vals = await p.evaluate(() => [...document.querySelectorAll('input')].filter(i => i.getBoundingClientRect().width > 0 && i.value && !['search','hidden'].includes(i.type)).map(i => `${(i.name||i.id||i.placeholder||'').slice(0,26)}=${i.value.slice(0,22)}`));
    console.log(`\n== ${id}  filled: ${JSON.stringify(got && got.filled)}  inputs: ${got && got.inputs}\n   values now: ${JSON.stringify(vals)}`);
    await p.screenshot({ path: `e2e/shots/signup-${id}.png` });
  } catch (e) { console.log(`\n== ${id}: ${String(e).slice(0, 120)}`); }
  await ctx.close();
}
await b.close();
