// Print the code around a store's order-history function, to see the URL it calls and where the user id comes from.
import { webkit, devices } from 'playwright';
const [site, ...pats] = process.argv.slice(2);
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'he-IL' }); const p = await ctx.newPage();
const scripts = new Set(); p.on('response', (r) => { if (r.request().resourceType() === 'script') scripts.add(r.url()); });
await p.goto(site, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null); await p.waitForTimeout(2000);
for (const u of scripts) { const t = await (await fetch(u)).text().catch(() => ''); for (const pat of pats) { const re = new RegExp(pat, 'g'); let m; let n = 0; while ((m = re.exec(t)) && n < 3) { n++; console.log(`\n[${u.split('/').pop().slice(0, 40)}] ${pat}:\n  ${t.slice(Math.max(0, m.index - 300), m.index + 500).replace(/\s+/g, ' ')}`); } } }
await b.close();
