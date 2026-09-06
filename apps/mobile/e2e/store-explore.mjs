/**
 * Store explorer: on a store's phone page, list every plausible "log in"
 * control, click each one on a fresh load, and report which produces a login
 * form (and what the form contains). Nothing is submitted.
 *
 *   node --experimental-strip-types e2e/store-explore.mjs <storeId> [url]
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';

const id = process.argv[2];
const url = process.argv[3] ?? STORES[id].loginUrl;
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });

const LOGIN_RE = /כניסה|התחבר|החשבון שלי|חשבון|משתמש|login|sign in|account|profile|user/i;

async function candidates(page) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
    const els = [...document.querySelectorAll('a,button,[role="button"],[onclick],svg,img,[class*="user" i],[class*="login" i],[class*="account" i],[aria-label]')];
    const out = [];
    els.forEach((el, i) => {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 60) : '';
      const href = el.getAttribute('href') || '';
      const hay = `${text} ${aria} ${cls} ${href}`;
      if (re.test(hay) && vis(el)) { el.setAttribute('data-lab', String(i)); out.push({ i, tag: el.tagName, text, aria, cls, href }); }
    });
    return out.slice(0, 25);
  }, LOGIN_RE.source);
}

const probeForm = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { url: location.href, email: q('input[type="email"]').length, password: q('input[type="password"]').length, tel: q('input[type="tel"]').length, text: q('input[type="text"]').length, otp: /קוד חד פעמי|שלח קוד|קוד אימות|SMS/.test(text), snippet: (text.match(/.{0,50}(כניסה|התחבר|קוד).{0,60}/) || [''])[0] };
});

const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(4000);
console.log('URL', page.url());
console.log('BEFORE', JSON.stringify(await probeForm(page)));
const cands = await candidates(page);
console.log('CANDIDATES', cands.length);
for (const c of cands) console.log('  ', c.i, c.tag, JSON.stringify(c.text), c.aria ? `aria=${c.aria}` : '', c.href ? `href=${c.href.slice(0, 60)}` : '', c.cls ? `cls=${c.cls}` : '');
for (const c of cands) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);
    await candidates(page); // re-tag
    const clicked = await page.evaluate((i) => { const el = document.querySelector(`[data-lab="${i}"]`); if (!el) return false; el.click(); return true; }, c.i);
    if (!clicked) continue;
    await page.waitForTimeout(2500);
    const f = await probeForm(page);
    const hit = f.email + f.password + f.tel > 0 || f.otp;
    console.log(hit ? 'HIT ' : 'miss', c.i, c.tag, JSON.stringify(c.text || c.aria || c.cls), '→', JSON.stringify(f));
    if (hit) await page.screenshot({ path: `e2e/shots/explore-${id}-${c.i}.png` });
  } catch (e) { console.log('err', c.i, String(e).slice(0, 100)); }
}
await browser.close();
