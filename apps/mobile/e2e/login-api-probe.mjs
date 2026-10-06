/**
 * Targeted login probes for the stores whose generic lab run did not reach
 * the "send" request: Rami Levy (e-mail + SMS/voice), Wolt (e-mail → code or
 * link), Hatzi Hinam (e-mail/ID + password). Same rule as the lab: every
 * non-GET request to any host is recorded and ABORTED. Nothing is sent.
 *
 *   node --experimental-strip-types e2e/login-api-probe.mjs [rami-levy|wolt|hazi-hinam ...]
 */
import { webkit, devices } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const LAB = { email: 'lab@example.com', tel: '0500000000', password: 'LabPassw0rd!' };
const noise = /google|facebook|yandex|tiktok|creativecdn|analytics|on\.aws|run\.app|gtag|doubleclick|hotjar|clarity|bing\.com|appsflyer|sentry|datadog|newrelic|dynatrace|insider|optimove|glassix|adoric|EcommerceProxy|segment|amplitude|mixpanel|braze|onesignal|firebase|cloudflareinsights/i;

const set = (page, sel, v) => page.evaluate(([sel, v]) => {
  const i = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, v);
  i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, [sel, v]);
const clickText = (page, re) => page.evaluate((src) => {
  const re = new RegExp(src);
  const b = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],label')].filter((e) => e.getBoundingClientRect().width > 0).find((b) => re.test((b.textContent || b.value || '').trim()));
  if (b) b.click();
  return b ? (b.textContent || b.value || '').trim().slice(0, 40) : null;
}, re.source);
const submitForm = (page, sel) => page.evaluate((sel) => {
  const i = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  const f = i?.closest('form');
  const b = f?.querySelector('button[type="submit"],input[type="submit"],button:not([type="button"])');
  if (b) { b.click(); return 'button:' + (b.textContent || b.value || '').trim().slice(0, 30); }
  if (f) { f.requestSubmit ? f.requestSubmit() : f.submit(); return 'form'; }
  return null;
}, sel);
const fields = (page) => page.evaluate(() => [...document.querySelectorAll('input,select')].filter((e) => e.getBoundingClientRect().width > 0 && !['hidden', 'submit', 'button', 'search'].includes(e.type)).map((i) => `${i.type}:${i.name || i.id || ''}"${(i.placeholder || i.getAttribute('aria-label') || '').slice(0, 30)}"`));
const text = (page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400));

const STEPS = {
  'rami-levy': async (page, log) => {
    await page.goto('https://www.rami-levy.co.il/he', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);
    log.open = await clickText(page, /^\s*(כניסה|התחברות)\s*$/);
    await page.waitForTimeout(1500);
    log.fields1 = await fields(page);
    log.emailSet = await set(page, 'input[type="email"]', LAB.email);
    log.smsPicked = await clickText(page, /הודעת SMS/);
    await page.waitForTimeout(300);
    log.submit = await submitForm(page, 'input[type="email"]');
    if (!log.submit) log.submit = await clickText(page, /שלח|המשך|קבל|התחבר|אישור/);
    await page.waitForTimeout(3500);
    log.fields2 = await fields(page);
    log.text2 = await text(page);
    // Phone variant: does the same dialog take a phone number?
    log.telSet = await set(page, 'input[type="tel"]', LAB.tel);
  },
  wolt: async (page, log) => {
    await page.goto('https://wolt.com/he/isr', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);
    log.open = await clickText(page, /^\s*(להתחבר|התחברות|כניסה|Log in)\s*$/) ?? await clickText(page, /להתחבר|התחברות|Log in/);
    await page.waitForTimeout(2000);
    log.fields1 = await fields(page);
    log.text1 = await text(page);
    log.emailSet = await set(page, 'input[type="email"]', LAB.email);
    await page.waitForTimeout(300);
    log.submit = await submitForm(page, 'input[type="email"]');
    if (!log.submit) log.submit = await clickText(page, /המשך|הבא|שלח|Continue|Next/);
    await page.waitForTimeout(4000);
    log.fields2 = await fields(page);
    log.text2 = await text(page);
    log.url2 = page.url();
  },
  'hazi-hinam': async (page, log) => {
    await page.goto('https://shop.hazi-hinam.co.il/authentication/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);
    log.fields1 = await fields(page);
    log.userSet = await set(page, '#userName,input[name="userName"],input[name*="user" i],form input[type="text"]', LAB.email);
    log.pwSet = await set(page, 'input[type="password"]', LAB.password);
    await page.waitForTimeout(300);
    log.submit = await submitForm(page, 'input[type="password"]');
    if (!log.submit) log.submit = await clickText(page, /כניסה|התחבר/);
    await page.waitForTimeout(3500);
    log.text2 = await text(page);
    log.url2 = page.url();
  },
};

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(STEPS);
const browser = await webkit.launch();
mkdirSync('e2e/lab', { recursive: true });
const out = {};
for (const id of ids) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const log = { requests: [] };
  await page.route('**/*', async (route) => {
    const r = route.request(); const m = r.method(); const u = r.url();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      if (!noise.test(u)) {
        const h = r.headers(); const keep = {};
        for (const k of ['content-type', 'accept', 'authorization', 'x-requested-with', 'x-csrf-token', 'csrf-token', 'x-xsrf-token', 'x-api-key', 'origin', 'referer', 'app-language', 'platform', 'client-version', 'x-wolt-web-clientid', 'w-wolt-session-id', 'clientversionnumber']) if (h[k]) keep[k] = String(h[k]).slice(0, 160);
        log.requests.push({ method: m, url: u.slice(0, 300), headers: keep, body: (r.postData() || '').slice(0, 1200) });
      }
      return route.abort();
    }
    return route.continue();
  });
  try { await STEPS[id](page, log); } catch (e) { log.error = String(e).slice(0, 200); }
  await page.screenshot({ path: `e2e/shots/probe-${id}.png` }).catch(() => null);
  out[id] = log;
  await ctx.close();
  console.log(`\n== ${id} ${JSON.stringify({ ...log, requests: undefined }, null, 1).replace(/\n\s*/g, ' ').slice(0, 900)}`);
  for (const q of log.requests) console.log(`   ${q.method} ${q.url}\n      H:${JSON.stringify(q.headers)}\n      B:${q.body.slice(0, 500)}`);
}
await browser.close();
writeFileSync('e2e/lab/login-api-probe.json', JSON.stringify(out, null, 2));
