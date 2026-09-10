/**
 * Wolt magic-link lab, live: a throwaway mailbox (mail.tm) asks Wolt for its
 * e-mail sign-in link, the lab reads the mail, opens the link in WebKit, and
 * records what the site does to turn the link into a session (endpoints,
 * bodies, response shapes, cookies). This is the one lab that lets requests
 * out - only Wolt and the throwaway mailbox are touched, with a fictive user.
 *
 *   node --experimental-strip-types e2e/wolt-magic-lab.mjs
 */
import { webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';

const MT = 'https://api.mail.tm';
const j = async (url, init) => { const r = await fetch(url, init); const t = await r.text(); try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; } };

// 1. mailbox
const dom = (await j(`${MT}/domains`)).d['hydra:member'][0].domain;
const address = `kaniti-lab-${Date.now().toString(36)}@${dom}`;
const password = `Lab-${Math.random().toString(36).slice(2)}!`;
const acc = await j(`${MT}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, password }) });
const tok = (await j(`${MT}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, password }) })).d.token;
console.log('mailbox', address, acc.s, tok ? 'token ok' : 'NO TOKEN');
const inbox = async () => (await j(`${MT}/messages`, { headers: { authorization: `Bearer ${tok}` } })).d['hydra:member'] ?? [];

// 2. ask Wolt for the link
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
const page = await ctx.newPage();
const log = { address, requests: [] };
const watch = /authentication\.wolt\.com|consumer-api\.wolt\.com\/(?!regatta|consumer-api\/consents)|wolt\.com\/.*(login|auth|magic|token|user)/i;
page.on('response', async (res) => {
  const req = res.request();
  if (!watch.test(req.url())) return;
  let body = '';
  try { body = (await res.text()).slice(0, 600); } catch { /* opaque */ }
  const h = req.headers(); const keep = {};
  for (const k of ['content-type', 'authorization', 'app-language', 'platform', 'client-version', 'x-wolt-web-clientid', 'w-wolt-session-id', 'clientversionnumber']) if (h[k]) keep[k] = String(h[k]).slice(0, 120);
  log.requests.push({ method: req.method(), url: req.url().slice(0, 300), headers: keep, body: (req.postData() || '').slice(0, 600), status: res.status(), response: body, setCookie: (res.headers()['set-cookie'] || '').split('\n').map((c) => c.split(';')[0].slice(0, 60)) });
});
await page.goto('https://wolt.com/he/isr', { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(3500);
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /להתחבר|התחברות|Log in/.test(x.textContent || '')); b?.click(); });
await page.waitForTimeout(2000);
await page.locator('input[type="email"]:visible').first().fill(address);
await page.locator('input[type="email"]:visible').first().press('Enter');
await page.waitForTimeout(5000);
log.afterSend = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
await page.screenshot({ path: 'e2e/shots/wolt-magic-1.png' });
console.log('after send:', log.afterSend);

// 3. read the mail
let link = null;
for (let i = 0; i < 24 && !link; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const msgs = await inbox();
  for (const m of msgs) {
    const full = (await j(`${MT}/messages/${m.id}`, { headers: { authorization: `Bearer ${tok}` } })).d;
    const html = (full.html || []).join(' ') + ' ' + (full.text || '');
    const links = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0].replace(/&amp;/g, '&'));
    log.mail = { from: m.from?.address, subject: m.subject, links: links.slice(0, 12) };
    link = links.find((l) => /wolt\.com\/[^ ]*(magic|login|auth|token)/i.test(l)) ?? links.find((l) => /wolt\.com/.test(l) && /token|code|=/.test(l)) ?? null;
  }
  process.stdout.write(`inbox ${msgs.length} `);
}
console.log('\nlink:', link);
if (link) {
  // 4. open it, record the exchange
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e) => { log.openErr = String(e).slice(0, 120); });
  await page.waitForTimeout(8000);
  log.afterLink = { url: page.url(), text: await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400)), fields: await page.evaluate(() => [...document.querySelectorAll('input')].filter((e) => e.getBoundingClientRect().width > 0).map((i) => `${i.type}:${i.name || i.id}"${i.placeholder || ''}"`)) };
  log.cookies = (await ctx.cookies()).map((c) => `${c.name}@${c.domain}${c.httpOnly ? ' httpOnly' : ''}=${c.value.slice(0, 12)}…`);
  log.wrtoken = (await ctx.cookies()).some((c) => c.name === '__wrtoken');
  await page.screenshot({ path: 'e2e/shots/wolt-magic-2.png' });
}
await browser.close();
writeFileSync('e2e/lab/wolt-magic.json', JSON.stringify(log, null, 2));
console.log(JSON.stringify({ ...log, requests: undefined }, null, 1));
for (const q of log.requests) console.log(`   ${q.method} ${q.status} ${q.url}\n      H:${JSON.stringify(q.headers)}\n      B:${q.body.slice(0, 300)}\n      R:${q.response.slice(0, 300)}\n      C:${q.setCookie.join(' | ')}`);
