/**
 * Detector lab: for every store, open the phone login page logged OUT, run the
 * app's own login-opening steps (side menus included), then run the store's
 * signed-in check. It must say "not signed in" on every one. Prints the header
 * text the check sees, so a false positive is explainable.
 *
 *   node --experimental-strip-types e2e/detector-lab.mjs [storeId ...]
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STORES);
const b = await webkit.launch(); let bad = 0;
for (const id of ids) {
  const s = STORES[id]; const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
  try {
    await p.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3500);
    for (let i = 0; i < 2; i++) { if (s.openLoginJs) await p.evaluate(s.openLoginJs).catch(() => null); await p.waitForTimeout(1500); }
    // What a person does on the phone: open the side menu (stor.ai) / the header menu, which lists "החשבון שלי".
    await p.evaluate(() => { const m = document.querySelector('.btn-toggle-side-nav,button[class*="side-nav"],button[aria-label*="תפריט"],[class*="hamburger"]'); if (m) m.click(); }).catch(() => null); await p.waitForTimeout(1200);
    const r = await p.evaluate(`(async()=>{try{const ok=await (${s.signedInCheck});const h=((document.querySelector('header')||document.body).innerText||'').replace(/\\s+/g,' ').slice(0,220);return {ok,h};}catch(e){return {ok:'ERR '+e.message,h:''}}})()`);
    if (r.ok !== false) bad++;
    console.log(`${(r.ok === false ? 'ok ' : 'BAD').padEnd(4)} ${id.padEnd(16)} signedIn=${r.ok}  header: ${r.h}`);
  } catch (e) { console.log(`err  ${id.padEnd(16)} ${String(e).slice(0, 80)}`); }
  await ctx.close();
}
await b.close(); console.log(bad ? `\n${bad} false positive(s)` : '\nno false positives'); process.exit(bad ? 1 : 0);
