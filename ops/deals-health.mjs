/**
 * מבצעים: sign in as the test family, ask for the deals feed, and check what a person would -
 * more than one chain worth looking at, and mostly real photographs, not drawn icons.
 *   node ops/deals-health.mjs        (reads ~/.kaniti/e2e.env)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';
const t0 = Date.now();
const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const me = await fetch(`${API}/me`, { headers: h }).then((r) => r.json());
const hid = me.households?.[0]?.id;
if (!hid) { console.log('BAD  /me has no household', JSON.stringify(me).slice(0, 200)); process.exit(1); }

const res = await fetch(`${API}/households/${hid}/deals`, { headers: h });
const j = await res.json().catch(() => ({}));
const deals = j.deals ?? [];
const chains = new Set(deals.map((d) => d.chainName));
// Promise 1 - the whole picture: a feed dominated by one chain is a family being shown one store's
// window and told it is "מבצעים" (deals, plural, everywhere) - the exact report from tonight.
const spanOk = res.status === 200 && deals.length > 0 && chains.size >= 3;
console.log(`${spanOk ? 'ok ' : 'BAD'}  מבצעים spans at least three chains — HTTP ${res.status}, ${deals.length} deals across ${chains.size} chain(s): ${[...chains].join(', ')}`);
// /deals answers from the image cache only; Home.tsx follows up with the same POST /images
// backfill List.tsx and Aisle.tsx already use, so the true promise is "mostly pictured once that
// backfill has run", not "the raw feed happens to be cache-warm" (which is near-0% right after a
// promotions refresh and would make this check flap on cache state, not the product).
const missing = deals.filter((d) => !d.imageUrl && d.gtin).map((d) => d.gtin);
const backfilled = missing.length ? await fetch(`${API}/households/${hid}/images`, { method: 'POST', headers: h, body: JSON.stringify({ gtins: missing.slice(0, 40) }) }).then((r) => r.json()).catch(() => ({ images: {} })) : { images: {} };
const pictured = deals.filter((d) => d.imageUrl || backfilled.images?.[d.gtin]).length;
// A drawn icon instead of a photograph is the commonest "the app looks unfinished"; most of a
// deals carousel a family scrolls through should be real pictures once Home's own backfill runs.
const picOk = deals.length > 0 && pictured >= deals.length * 0.6;
console.log(`${picOk ? 'ok ' : 'BAD'}  most deals have a real picture, not a drawn icon, once backfilled — ${pictured}/${deals.length}`);
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(spanOk && picOk ? 0 : 1);
