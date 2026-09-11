// Walk Shufersal's "forgot password" flow in WebKit (iPhone) with every non-GET
// aborted: what the code step looks like, and what the app's OTP tuner would do to it.
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const posts = [];
await p.route('**/*', (r) => { const q = r.request(); if (!['GET','HEAD','OPTIONS'].includes(q.method())) { if (/shufersal/.test(q.url())) posts.push(`${q.method()} ${q.url().slice(0,120)} ${(q.postData()||'').slice(0,200)}`); return r.abort(); } return r.continue(); });
await p.goto(STORES.shufersal.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3000);
await p.evaluate(STORES.shufersal.forgotJs); await p.waitForTimeout(2500);
const dump = async (label) => { const d = await p.evaluate(() => { const vis=(e)=>e.getBoundingClientRect().width>0; const inputs=[...document.querySelectorAll('input')].filter(vis).map(i=>`${i.type}|name=${i.name}|id=${i.id}|ph=${i.placeholder}|ac=${i.getAttribute('autocomplete')}|ml=${i.maxLength}|im=${i.getAttribute('inputmode')}|pat=${i.getAttribute('pattern')}`); const forms=[...document.querySelectorAll('form')].filter(vis).map(f=>`${f.id}|${f.getAttribute('action')}|${f.method}`); const btns=[...document.querySelectorAll('button,input[type=submit]')].filter(vis).map(b=>`${(b.textContent||b.value||'').trim().slice(0,30)}${b.disabled?'(disabled)':''}`); return { url: location.href, text: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,400), inputs, forms, btns }; }); console.log(`\n== ${label}\n url: ${d.url}\n text: ${d.text}\n inputs: ${JSON.stringify(d.inputs,null,0)}\n forms: ${JSON.stringify(d.forms)}\n buttons: ${JSON.stringify(d.btns)}`); };
await dump('after forgotJs');
// Fill an e-mail and submit (aborted), to reach the code step's DOM if it is client-rendered.
await p.evaluate(STORES.shufersal.prefillEmailJs('lab@example.com')); await p.waitForTimeout(500);
await p.evaluate(() => { const f=[...document.querySelectorAll('form')].find(f=>f.getBoundingClientRect().width>0 && f.querySelector('input:not([type=hidden])')); const b=f&&f.querySelector('button[type=submit],input[type=submit],button'); if(b) b.click(); else if(f) f.requestSubmit(); });
await p.waitForTimeout(3000); await dump('after submit (aborted)');
console.log('\nposts:', posts.length); for (const x of posts) console.log('  ', x);
await p.screenshot({ path: 'e2e/shots/shufersal-reset.png' });
await b.close();
