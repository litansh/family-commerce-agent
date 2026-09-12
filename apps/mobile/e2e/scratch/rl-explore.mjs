import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
await p.goto('https://www.rami-levy.co.il/he', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(5000);
const r = await p.evaluate(() => {
  const ls = {}; for (const k of Object.keys(localStorage)) ls[k] = (localStorage.getItem(k) || '').length;
  const ss = {}; for (const k of Object.keys(sessionStorage)) ss[k] = (sessionStorage.getItem(k) || '').length;
  const n = window.$nuxt; const a = n && n.$auth;
  const out = { ls, ss, cookies: document.cookie.split(';').map(c => c.trim().split('=')[0]), authOpts: a && a.options ? { cookie: a.options.cookie, localStorage: a.options.localStorage, strategy: a.strategy && a.strategy.name, tokenOpts: a.strategy && a.strategy.options && a.strategy.options.token, endpoints: a.strategy && a.strategy.options && a.strategy.options.endpoints } : null, storage: a && a.$storage ? Object.keys(a.$storage).slice(0, 12) : null, ramilevy: (localStorage.getItem('ramilevy') || '').slice(0, 600) };
  return out;
});
console.log(JSON.stringify(r, null, 1));
// plant a token the way nuxt-auth does
const r2 = await p.evaluate(() => { const a = window.$nuxt.$auth; a.$storage.setUniversal('_token.local', 'Bearer LABTOKEN-0123456789'); a.$storage.setUniversal('_refresh_token.local', 'LABREFRESH-0123456789'); return { ls: Object.keys(localStorage), cookies: document.cookie.split(';').map(c => c.trim()).filter(c=>/auth/.test(c)), loggedIn: a.loggedIn, tokenGet: a.strategy.token && a.strategy.token.get && a.strategy.token.get() }; });
console.log(JSON.stringify(r2, null, 1));
const cookies = await ctx.cookies(); console.log(cookies.map(c => `${c.name} httpOnly=${c.httpOnly} domain=${c.domain} path=${c.path} secure=${c.secure} sameSite=${c.sameSite} exp=${c.expires}`).join('\n'));
await b.close();
