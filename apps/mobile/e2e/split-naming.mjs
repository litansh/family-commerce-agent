/**
 * The compare names the product per store (docs/design/item-identity.md, promises 1 and 4).
 *
 * A line the family asked for as "כל מותג" resolves to a different product in every chain — "חלב 3%"
 * is a 2 ℓ יטבתה bottle at one and a 1 ℓ bag at the next. Two totals are only comparable, and a split
 * only legible, when each store's own product is named where its price is shown. The screens use
 * `src/lib/quote.ts#productAt` for that; this lab runs the very same function over a real compare for
 * the test family and checks that nothing a screen would name differs from what the cart will add.
 *
 *   node apps/mobile/e2e/split-naming.mjs        (reads ~/.kaniti/e2e.env; GET/compare only, nothing is ordered)
 *
 * Exit 1 when a screen would name a product the store that fills the basket did not price.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { productAt } from '../src/lib/quote.ts';

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';

const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth'); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const hid = (await fetch(`${API}/me`, { headers: h }).then((r) => r.json())).households?.[0]?.id;
if (!hid) { console.log('BAD  no household'); process.exit(1); }

// Any-brand lines on purpose: no gtin, no brand — the case the design calls "כל מותג", where every
// chain is free to price its own product.
const lines = [
  { id: 'a', query: 'חלב 3%', qty: 2 }, { id: 'b', query: 'ביצים L', qty: 1 },
  { id: 'c', query: 'לחם אחיד פרוס', qty: 1 }, { id: 'd', query: 'קוטג׳ 5%', qty: 2 },
  { id: 'e', query: 'פילה סלמון', qty: 1 },
];
// The phone's path: the compare as a job, collected when done. One retry — a slow provider minute is
// not a failed check.
const compare = async () => {
  let job = await (await fetch(`${API}/households/${hid}/compares`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) })).json();
  const t0 = Date.now();
  while (job.status === 'pending' && Date.now() - t0 < 180_000) { await new Promise((r) => setTimeout(r, 2000)); job = await (await fetch(`${API}/households/${hid}/compares/${job.id}`, { headers: h })).json(); }
  return job;
};
let job = await compare();
if (job.status !== 'done') { console.log(`     compare ${job.status} (${job.error ?? ''}); retrying once`); job = await compare(); }
const q = job.result;
if (!q?.options?.length) { console.log(`BAD  no compare to read — ${job.status} ${job.error ?? ''}`); process.exit(1); }
console.log(`ok   compare done — ${q.options.length} option(s), ${q.rejected.length} rejected`);

const nameOf = (id) => q.lines.find((l) => l.id === id)?.query ?? id;
let mismatches = 0, shared = 0, named = 0, wouldHaveDrifted = 0;
for (const o of q.options) {
  console.log(`\n${o.legs.map((l) => l.brand).join(' + ')}  ₪${(o.cashCost / 100).toFixed(2)}`);
  for (const leg of o.legs) {
    for (const id of leg.lineIds) {
      const shown = productAt(q, leg.storefrontId, id);           // what the screens now name
      const fills = q.storefrontLines?.[leg.storefrontId]?.[id];  // what this store priced and the cart adds
      const flat = q.quotedLines?.[id];                           // the old, shared resolution
      named += 1;
      if (!shown.own) shared += 1;
      if (fills && shown.productName !== fills.productName) { mismatches += 1; console.log(`  BAD  ${leg.brand} · ${nameOf(id)}: screen "${shown.productName}" ≠ cart "${fills.productName}"`); continue; }
      // Why the rule exists: how often naming the shared resolution here would name another store's product.
      const off = fills && flat && flat.productName !== fills.productName;
      if (off) wouldHaveDrifted += 1;
      const drift = off ? `   (the shared resolution said "${flat.productName}")` : '';
      console.log(`  ${nameOf(id)}  →  ${shown.productName ?? '(nothing named)'}${shown.own ? '' : '  [shared resolution — this store named none]'}${drift}`);
    }
  }
}

// The same line, every store that priced it: the wall the design is there to make readable.
console.log('\nsame line, every store:');
for (const l of q.lines) {
  const per = Object.entries(q.storefrontLines ?? {}).flatMap(([sid, m]) => (m[l.id] ? [`${sid}: ${m[l.id].productName}`] : []));
  if (per.length) console.log(`  ${l.query}\n${per.map((p) => `     ${p}`).join('\n')}`);
}

console.log(`\n${mismatches === 0 ? 'ok ' : 'BAD'}  every named product is the one that store will add — ${named} line(s) across the options, ${shared} fell back to the shared resolution, ${mismatches} mismatch(es)`);
console.log(`     ${wouldHaveDrifted} of those line(s) would have been named after another store's product by the shared resolution — that is what this rule is for`);
process.exit(mismatches === 0 ? 0 : 1);
