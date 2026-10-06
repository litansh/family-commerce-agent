/**
 * Discovery: with the saved session, walk the account pages and record every
 * JSON request the site makes, so the connector can use the real endpoints
 * rather than guesses. Output goes to trace/discover-*.json and .html.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { loadSession } from './session.ts';

const HID = process.env['KANITI_HOUSEHOLD'] ?? '';
const BASE = 'https://www.shufersal.co.il/online/he';
const PAGES = ['/my-account/orders', '/my-account/coupons', '/my-account', '/my-account/personal-area', '/wish-lists/main'];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 }, storageState: loadSession(HID, 'shufersal') });
const page = await ctx.newPage();
const seen: { url: string; status: number; type: string; sample: string }[] = [];
page.on('response', async (r) => {
  const ct = r.headers()['content-type'] ?? '';
  const u = r.url();
  if (!u.includes('shufersal.co.il')) return;
  if (ct.includes('json') || u.includes('/my-account') || u.includes('coupon') || u.includes('order')) {
    let sample = '';
    try { sample = (await r.text()).slice(0, 600); } catch { /* binary */ }
    seen.push({ url: u, status: r.status(), type: ct.split(';')[0] ?? ct, sample });
  }
});
for (const p of PAGES) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const stamp = p.replace(/\W+/g, '_');
  await page.screenshot({ path: `trace/discover${stamp}.png` }).catch(() => undefined);
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="my-account"], a[href*="order"], a[href*="coupon"]')).map((a) => (a as HTMLAnchorElement).href).filter((h, i, arr) => arr.indexOf(h) === i).slice(0, 40));
  const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500));
  writeFileSync(`trace/discover${stamp}.txt`, `URL: ${page.url()}\nLINKS:\n${links.join('\n')}\n\nTEXT:\n${text}`);
  console.log(`${p} -> ${page.url()}  links=${links.length}`);
}
writeFileSync('trace/discover-requests.json', JSON.stringify(seen, null, 1));
console.log('json/account requests captured:', seen.length);
for (const s of seen.filter((x) => x.type.includes('json'))) console.log(' ', s.status, s.url.replace('https://www.shufersal.co.il', ''), '|', s.sample.replace(/\s+/g, ' ').slice(0, 100));
await browser.close();
