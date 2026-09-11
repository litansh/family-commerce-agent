/**
 * API health: sign in as the test family, ask for a quote, and report what came back.
 *   node ops/api-health.mjs        (reads ~/.kaniti/e2e.env)
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
const lines = [{ id: 'a', query: 'חלב 3%', gtin: '7290004131074', qty: 2 }, { id: 'b', query: 'אפונה יכין', gtin: '7290000208114', qty: 1 }, { id: 'c', query: 'ביצים L', qty: 1 }];
const res = await fetch(`${API}/households/${hid}/quote`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) });
const q = await res.json().catch(() => ({}));
const ok = res.status === 200 && Array.isArray(q.options) && q.options.length > 0;
console.log(`${ok ? 'ok ' : 'BAD'}  quote ${res.status} options=${q.options?.length ?? 0} rejected=${q.rejected?.length ?? 0} etas=${Object.keys(q.etas ?? {}).length} drive=${q.drive?.status ?? '-'}(${q.drive?.branches?.length ?? 0}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
