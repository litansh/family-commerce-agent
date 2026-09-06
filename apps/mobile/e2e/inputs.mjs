import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const s = STORES[process.argv[2]];
const b = await webkit.launch(); const p = await (await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' })).newPage();
const resp = await p.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4500);
for (let i = 0; i < 2; i++) { if (s.openLoginJs) await p.evaluate(s.openLoginJs).catch(() => null); await p.waitForTimeout(1500); }
console.log('status', resp?.status(), 'url', p.url(), 'title', await p.title());
console.log('text head:', (await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300))));
console.log('inputs:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, id: i.id, ph: i.placeholder, vis: i.getBoundingClientRect().width > 0, inForm: !!i.closest('form') })))));
await p.screenshot({ path: `e2e/shots/inputs-${process.argv[2]}.png` }); await b.close();
