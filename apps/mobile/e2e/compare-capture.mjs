/**
 * Capture one real compare for the test family and write it to a file, so the compare-screen labs can
 * read a family's real numbers without asking the provider again (the provider is slow and it is a
 * budget). GET/compare only — nothing is ordered.
 *
 *   node apps/mobile/e2e/compare-capture.mjs [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';

const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth'); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const hid = (await fetch(`${API}/me`, { headers: h }).then((r) => r.json())).households?.[0]?.id;
if (!hid) { console.log('BAD  no household'); process.exit(1); }

// A household's ordinary week: any-brand lines (every chain prices its own product), a line the
// chains stock unevenly, and enough of them that a store or two falls short.
const lines = [
  { id: 'a', query: 'חלב 3%', qty: 2 }, { id: 'b', query: 'ביצים L', qty: 1 },
  { id: 'c', query: 'לחם אחיד פרוס', qty: 1 }, { id: 'd', query: 'קוטג׳ 5%', qty: 2 },
  { id: 'e', query: 'פילה סלמון', qty: 1 }, { id: 'f', query: 'בננות', qty: 1 },
  { id: 'g', query: 'שמן זית', qty: 1 }, { id: 'h', query: 'טופו', qty: 1 },
];
const compare = async () => {
  let job = await (await fetch(`${API}/households/${hid}/compares`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) })).json();
  const t0 = Date.now();
  while (job.status === 'pending' && Date.now() - t0 < 180_000) { await new Promise((r) => setTimeout(r, 2000)); job = await (await fetch(`${API}/households/${hid}/compares/${job.id}`, { headers: h })).json(); }
  return job;
};
let job = await compare();
if (job.status !== 'done') { console.log(`     compare ${job.status} (${job.error ?? ''}); retrying once`); job = await compare(); }
if (!job.result?.options) { console.log(`BAD  no compare — ${job.status} ${job.error ?? ''}`); process.exit(1); }
const out = process.argv[2] ?? 'apps/mobile/e2e/shots/compare.json';
writeFileSync(out, JSON.stringify(job.result, null, 1));
console.log(`ok   compare captured to ${out} — ${job.result.options.length} option(s), ${job.result.rejected.length} rejected`);
