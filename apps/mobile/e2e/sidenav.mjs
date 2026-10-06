import { webkit, devices } from 'playwright';
const url = process.argv[2];
const b = await webkit.launch(); const p = await (await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' })).newPage();
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4500);
await p.evaluate(() => { const b = document.querySelector('.btn-toggle-side-nav,button[class*="side-nav"],button[class*="menu"],[aria-label*="תפריט"]'); if (b) b.click(); });
await p.waitForTimeout(2000);
const items = await p.evaluate(() => [...document.querySelectorAll('a,button,li,[role="button"],[role="menuitem"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10 && r.left < 400; }).map(el => ({ tag: el.tagName, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), href: el.getAttribute('href') || '', cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50), aria: el.getAttribute('aria-label') || '' })).filter(x => x.text || x.aria).slice(0, 45));
for (const it of items) console.log(it.tag.padEnd(6), JSON.stringify(it.text), it.aria ? 'aria=' + it.aria : '', it.href ? 'href=' + it.href : '', it.cls ? 'cls=' + it.cls : '');
await p.screenshot({ path: 'e2e/shots/sidenav.png' });
// try clicking a login-looking item
const hit = await p.evaluate(() => { const el = [...document.querySelectorAll('a,button,li,[role="button"],span,div')].find(x => /^\s*(כניסת משתמש|כניסה|התחברות|כניסה לחשבון|התחברות לחשבון|החשבון שלי)\s*$/.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0); if (el) { el.click(); return (el.innerText || '').trim(); } return null; });
await p.waitForTimeout(3000);
const f = await p.evaluate(() => { const vis = (el) => el.getBoundingClientRect().width > 0; const q = (s) => [...document.querySelectorAll(s)].filter(vis); const t = (document.body.innerText || '').replace(/\s+/g, ' '); return { url: location.href, email: q('input[type=email]').length, pw: q('input[type=password]').length, tel: q('input[type=tel]').length, text: q('input[type=text]').length, otp: /קוד חד פעמי|שלח קוד|קוד אימות|SMS/.test(t), snippet: (t.match(/.{0,60}(קוד חד פעמי|שלח קוד|סיסמה|דואר).{0,60}/) || [''])[0] }; });
console.log('CLICKED', JSON.stringify(hit), '→', JSON.stringify(f));
await p.screenshot({ path: 'e2e/shots/sidenav-after.png' }); await b.close();
