import { webkit, devices } from 'playwright';
const url = process.argv[2];
const b = await webkit.launch(); const p = await (await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' })).newPage();
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4500);
const out = await p.evaluate(() => {
  const H = innerHeight; const rows = [];
  for (const el of document.querySelectorAll('a,button,[role="button"],[onclick],svg,img,i,span,div')) {
    const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8 || r.width > 200) continue;
    if (!(r.top < 130 || r.bottom > H - 110)) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.children.length > 4) continue;
    rows.push({ tag: el.tagName, y: Math.round(r.top), x: Math.round(r.left), w: Math.round(r.width), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), aria: el.getAttribute('aria-label') || '', cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70), href: el.getAttribute('href') || '', id: el.id || '' });
  }
  const seen = new Set(); return rows.filter(r => { const k = `${r.tag}${r.x}${r.y}${r.cls}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60);
});
for (const r of out) console.log(`${r.tag.padEnd(6)} y${String(r.y).padStart(4)} x${String(r.x).padStart(4)} w${String(r.w).padStart(3)} ${JSON.stringify(r.text)} ${r.aria ? 'aria=' + r.aria : ''} ${r.id ? '#' + r.id : ''} ${r.cls ? 'cls=' + r.cls : ''} ${r.href ? 'href=' + r.href : ''}`);
await p.screenshot({ path: 'e2e/shots/dump.png' }); await b.close();
