/**
 * Round two: Rami Levy and Hatzi Hinam did not reach their login request in
 * round one. Log every request to the store's own API hosts (GET included)
 * after the submit, wait longer, and try Enter in the field as well as the
 * button. Non-GET requests are still aborted - nothing is sent.
 *
 *   node --experimental-strip-types e2e/login-api-probe2.mjs [rami-levy|hazi-hinam]
 */
import { webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';

const LAB = { email: 'lab@example.com', tel: '0500000000', password: 'LabPassw0rd!' };
const own = /rami-levy\.co\.il|hazi-hinam\.co\.il/i;
const noise = /cdn-cgi|\.(js|css|png|jpg|svg|woff2?|gif|ico|webp)(\?|$)|\/api\/catalog|static\/menu|applicationinsights/i;

const setv = (page, sel, v) => page.evaluate(([sel, v]) => {
  const i = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!i) return false;
  i.focus();
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, v);
  i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}, [sel, v]);
const clickText = (page, re) => page.evaluate((src) => {
  const re = new RegExp(src);
  const b = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],label')].filter((e) => e.getBoundingClientRect().width > 0).find((b) => re.test((b.textContent || b.value || '').trim()));
  if (b) b.click();
  return b ? (b.textContent || b.value || '').trim().slice(0, 40) : null;
}, re.source);
const text = (page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500));
const formInfo = (page, sel) => page.evaluate((sel) => {
  const i = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  const f = i?.closest('form');
  return f ? { action: f.getAttribute('action'), method: f.getAttribute('method'), buttons: [...f.querySelectorAll('button,input[type=submit]')].map((b) => `${b.type}:${(b.textContent || b.value || '').trim().slice(0, 20)}:${b.disabled ? 'disabled' : 'on'}`), inputs: [...f.querySelectorAll('input')].map((x) => `${x.type}:${x.name}=${x.value.slice(0, 20)}:${x.checked}`) } : null;
}, sel);

const STEPS = {
  'rami-levy': async (page, log) => {
    await page.goto('https://www.rami-levy.co.il/he', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);
    log.open = await clickText(page, /^\s*(כניסה|התחברות)\s*$/);
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]:visible').first().fill(LAB.email).catch((e) => { log.fillErr = String(e).slice(0, 80); });
    await page.locator('input[value="sms"], input[type="radio"]').first().check({ force: true }).catch(() => null);
    log.form = await formInfo(page, 'input[type="email"]');
    await page.locator('input[type="email"]:visible').first().press('Enter').catch(() => null);
    await page.waitForTimeout(6000);
    log.text2 = await text(page);
    log.form2 = await formInfo(page, 'input[type="email"]');
    if (log.requests.filter((r) => /login|auth|otp|sms|user/i.test(r.url)).length === 0) {
      log.btn = await clickText(page, /^\s*(התחברות|שלח|המשך|כניסה)\s*$/);
      await page.waitForTimeout(6000);
      log.text3 = await text(page);
    }
  },
  'hazi-hinam': async (page, log) => {
    await page.goto('https://shop.hazi-hinam.co.il/authentication/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);
    await page.locator('#userName, input[name="userName"]').first().fill(LAB.email).catch((e) => { log.fillErr = String(e).slice(0, 80); });
    await page.locator('input[type="password"]').first().fill(LAB.password).catch(() => null);
    log.form = await formInfo(page, 'input[type="password"]');
    await page.locator('input[type="password"]').first().press('Enter').catch(() => null);
    await page.waitForTimeout(6000);
    log.text2 = await text(page);
    if (log.requests.filter((r) => /login|auth|token|user|account/i.test(r.url)).length === 0) {
      log.btn = await clickText(page, /כניסה לחשבון שלי|^\s*כניסה\s*$/);
      await page.waitForTimeout(6000);
      log.text3 = await text(page);
    }
  },
};

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(STEPS);
const browser = await webkit.launch();
const out = {};
for (const id of ids) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const log = { requests: [] };
  await page.route('**/*', async (route) => {
    const r = route.request(); const m = r.method(); const u = r.url();
    if (own.test(u) && !noise.test(u) && r.resourceType() !== 'document') {
      const h = r.headers(); const keep = {};
      for (const k of ['content-type', 'accept', 'authorization', 'x-requested-with', 'x-csrf-token', 'x-xsrf-token', 'x-api-key', 'origin', 'referer', 'ecomtoken', 'locale', 'x-language']) if (h[k]) keep[k] = String(h[k]).slice(0, 160);
      log.requests.push({ method: m, url: u.slice(0, 300), headers: keep, body: (r.postData() || '').slice(0, 800), type: r.resourceType() });
    }
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') return route.abort();
    return route.continue();
  });
  try { await STEPS[id](page, log); } catch (e) { log.error = String(e).slice(0, 200); }
  await page.screenshot({ path: `e2e/shots/probe2-${id}.png` }).catch(() => null);
  out[id] = log;
  await ctx.close();
  console.log(`\n== ${id} ${JSON.stringify({ ...log, requests: undefined }).slice(0, 1500)}`);
  for (const q of log.requests) console.log(`   ${q.method} ${q.type} ${q.url}\n      H:${JSON.stringify(q.headers)}\n      B:${q.body.slice(0, 400)}`);
}
await browser.close();
writeFileSync('e2e/lab/login-api-probe2.json', JSON.stringify(out, null, 2));
