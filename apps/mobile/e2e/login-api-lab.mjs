/**
 * Login-API lab: for every store, open the phone login page in WebKit
 * (iPhone emulation), drive it exactly as a person would - open the login,
 * type a phone / e-mail / password, tap the primary button - and record the
 * HTTP request the site *tries* to make. Every non-GET request is aborted
 * before it leaves the machine, so no SMS, e-mail or account is ever created.
 *
 * Then, on the same site, open the "new account" form and list its fields,
 * so the sign-up helper knows what each store asks a new person for.
 *
 *   node --experimental-strip-types e2e/login-api-lab.mjs [storeId ...]
 *
 * Output: e2e/lab/login-api.json (per store: requests[], registerFields[])
 */
import { webkit, devices } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { STORES } from '../src/lib/stores.ts';

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(STORES);
const LAB = { email: 'lab@example.com', tel: '0500000000', password: 'LabPassw0rd!' };
const PRIMARY = /שלח|שלחו|קבל|כניסה|התחבר|המשך|אישור|log ?in|continue|send|next|submit/i;
const REGISTER = /הרשמה|הירשם|הרשם|הצטרפ|משתמש חדש|לקוח חדש|צור חשבון|יצירת חשבון|sign ?up|register|create account/i;

const browser = await webkit.launch();
const out = {};
mkdirSync('e2e/lab', { recursive: true });

async function fillVisible(page) {
  return page.evaluate((LAB) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const set = (i, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); };
    const filled = [];
    for (const i of [...document.querySelectorAll('input')].filter(vis)) {
      const a = `${i.type} ${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('autocomplete') || ''}`;
      let v = null;
      if (i.type === 'password') v = LAB.password;
      else if (i.type === 'tel' || /phone|tel|טלפון|נייד/i.test(a)) v = LAB.tel;
      else if (i.type === 'email' || /mail|מייל|user|j_username/i.test(a)) v = LAB.email;
      if (v != null && !i.value) { set(i, v); filled.push(a.trim()); }
    }
    return filled;
  }, LAB);
}

async function visibleInputs(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const label = (i) => { const l = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : i.closest('label'); return (l?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); };
    return [...document.querySelectorAll('input,select,textarea')].filter(vis).filter((i) => !['hidden', 'submit', 'button'].includes(i.type)).map((i) => ({
      tag: i.tagName.toLowerCase(), type: i.type, name: i.name || undefined, id: i.id || undefined, placeholder: i.placeholder || undefined,
      autocomplete: i.getAttribute('autocomplete') || undefined, required: i.required || undefined, maxlength: i.maxLength > 0 ? i.maxLength : undefined, label: label(i) || undefined,
    }));
  });
}

async function clickText(page, re) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cands = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].filter(vis).filter((b) => re.test((b.textContent || b.value || '').trim()));
    if (!cands.length) return null;
    // Prefer a real submit inside the form that holds the inputs we filled.
    const inForm = cands.find((b) => b.closest('form')?.querySelector('input:not([type=hidden])'));
    const b = inForm ?? cands[0];
    b.click();
    return (b.textContent || b.value || '').trim().slice(0, 40);
  }, re.source);
}

for (const id of ids) {
  const s = STORES[id];
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const row = { id, loginUrl: s.loginUrl, requests: [], register: null, note: '' };
  let capture = false;
  await page.route('**/*', async (route) => {
    const r = route.request();
    const m = r.method();
    const u = r.url();
    const api = /api|auth|login|otp|sms|register|account|user|token|graphql|customer|member/i.test(u) && !/\.(js|css|png|jpg|svg|woff2?|gif|ico)(\?|$)/i.test(u);
    if (capture && (m !== 'GET' || api)) {
      const h = r.headers();
      const keep = {};
      for (const k of ['content-type', 'accept', 'authorization', 'x-requested-with', 'x-csrf-token', 'csrf-token', 'x-xsrf-token', 'x-api-key', 'origin', 'referer']) if (h[k]) keep[k] = String(h[k]).slice(0, 120);
      row.requests.push({ method: m, url: u.slice(0, 300), headers: keep, body: (r.postData() || '').slice(0, 800), type: r.resourceType() });
    }
    // Nothing that could send an SMS, an e-mail, or create anything leaves the machine.
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && capture) return route.abort();
    return route.continue();
  });
  try {
    await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);
    for (let i = 0; i < 2; i++) { if (s.openLoginJs) await page.evaluate(s.openLoginJs).catch(() => null); await page.waitForTimeout(1200); }
    row.loginFields = await visibleInputs(page);
    capture = true;
    row.filled = await fillVisible(page);
    await page.waitForTimeout(500);
    row.clicked = await clickText(page, PRIMARY);
    await page.waitForTimeout(3000);
    // A second step may have appeared (e.g. the code box after "send code").
    row.afterFields = await visibleInputs(page);
    await page.screenshot({ path: `e2e/shots/api-${id}.png` });
    capture = false;

    // Sign-up form: what does a new person have to give this store?
    const reg = await ctx.newPage();
    await reg.route('**/*', (route) => (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort()));
    await reg.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await reg.waitForTimeout(3000);
    for (let i = 0; i < 2; i++) { if (s.openLoginJs) await reg.evaluate(s.openLoginJs).catch(() => null); await reg.waitForTimeout(1000); }
    const hit = await clickText(reg, REGISTER);
    await reg.waitForTimeout(3000);
    row.register = { clicked: hit, url: reg.url(), fields: await visibleInputs(reg), text: (await reg.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300))) };
    await reg.screenshot({ path: `e2e/shots/register-${id}.png` });
    await reg.close();
  } catch (e) { row.note = String(e).slice(0, 200); }
  out[id] = row;
  await ctx.close();
  const reqs = row.requests.filter((r) => r.method !== 'GET');
  console.log(`\n== ${id}  filled:${(row.filled || []).length} clicked:${row.clicked ?? '-'}  non-GET requests:${reqs.length}  register:${row.register?.clicked ?? '-'} (${row.register?.fields?.length ?? 0} fields) ${row.note}`);
  for (const r of reqs) console.log(`   ${r.method} ${r.url}\n      ${r.body.slice(0, 200)}`);
  for (const f of row.register?.fields ?? []) console.log(`   + ${f.type} ${f.name ?? ''} ${f.id ?? ''} "${f.placeholder ?? f.label ?? ''}"`);
}
await browser.close();
writeFileSync('e2e/lab/login-api.json', JSON.stringify(out, null, 2));
console.log('\nwritten e2e/lab/login-api.json');
