/**
 * Search health: sign in as the test family and ask the catalogue search for the words a family
 * actually types — everyday Hebrew groceries, not the provider's own vocabulary. Red when any one
 * of them comes back with no products, so a store the provider cannot search (tofu, chocolate: the
 * evidence behind ADR 0010's second rung under Compare) is caught here, before a family meets it.
 *   node ops/search-health.mjs        (reads ~/.kaniti/e2e.env)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';

const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const me = await fetch(`${API}/me`, { headers: h }).then((r) => r.json());
const hid = me.households?.[0]?.id;
if (!hid) { console.log('BAD  /me has no household', JSON.stringify(me).slice(0, 200)); process.exit(1); }

// Every one of these is a real family's everyday list, not an edge case; a store on the list that
// cannot be found is the exact family-facing failure a broken search rung produces.
const WORDS = ['טופו', 'שוקולד', 'חלב', 'לחם', 'ביצים', 'קוטג\'', 'סלמון', 'בננות'];

const results = await Promise.all(WORDS.map(async (q) => {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/households/${hid}/search?q=${encodeURIComponent(q)}`, { headers: h });
    const j = await res.json().catch(() => ({}));
    const n = Array.isArray(j.products) ? j.products.length : 0;
    return { q, ok: res.status === 200 && n > 0, n, status: res.status, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    return { q, ok: false, n: 0, status: 'error', error: String(e?.message ?? e), seconds: (Date.now() - t0) / 1000 };
  }
}));

for (const r of results) console.log(`${r.ok ? 'ok ' : 'BAD'}  ${r.q.padEnd(8)} ${String(r.n).padStart(2)} product(s), HTTP ${r.status}, ${r.seconds.toFixed(1)}s${r.error ? ` — ${r.error}` : ''}`);
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length}/${results.length} everyday item(s) could not be found: ${bad.map((r) => r.q).join(', ')}` : `\nall ${results.length} everyday items resolve to at least one product`);
process.exit(bad.length ? 1 : 0);
