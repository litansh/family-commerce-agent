/**
 * Pictures for מבצעים from the chain's own product pages, gathered on the ops Mac. Never from the
 * API's Lambda (ADR 0011: Shufersal answers a data centre with a block page; this Mac gets the page
 * a shopper gets).
 *
 * Why: every deal has a barcode, but the API's resolver has only Rami Levy's CDN and Open Food
 * Facts (services/product-images/src/index.ts). Shufersal's fresh meat and fish, and its Lego, are
 * in neither one, so `deals` sat at 5/23 pictured (health 2026-10-08). Shufersal publishes each of
 * these on its own page with its own photograph.
 *
 * Ladder (ADR 0010), deals pictures:
 *   rung 1  the API resolver: Rami Levy CDN, then Open Food Facts (by barcode, cached IMG#G#<gtin>)
 *   rung 2  this script: the chain's own product page, read with GETs only from this Mac, and kept
 *           through POST /images/learned under the same key, so /deals and Home read it from cache
 *   last    the drawn icon with the product's name. Tapping the deal opens it in the chain's own
 *           pages with the list beside it
 * It runs as the test family because /deals is per household and the learned-images route is the
 * one write path that needs no AWS session on this Mac. The cache key is global (IMG#G#<gtin>), so
 * every household gets the picture.
 *
 *   node services/product-images/refresh-chain-images.mjs [--dry-run]     (reads ~/.kaniti/e2e.env)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { shufersalCodes, readShufersalPage, sameProduct } from './src/shufersal-page.ts';

const DRY = process.argv.includes('--dry-run');
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));

const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('chain-images: no Kaniti sign-in', JSON.stringify(auth).slice(0, 160)); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const hid = (await fetch(`${API}/me`, { headers: h }).then((r) => r.json())).households?.[0]?.id;
const deals = (await fetch(`${API}/households/${hid}/deals`, { headers: h }).then((r) => r.json())).deals ?? [];

// Ask the API's own resolver first (rung 1), so this script only reads pages for what it cannot answer.
const unpictured = deals.filter((d) => !d.imageUrl && d.gtin);
const rung1 = unpictured.length ? (await fetch(`${API}/households/${hid}/images`, { method: 'POST', headers: h, body: JSON.stringify({ gtins: unpictured.map((d) => d.gtin).slice(0, 40) }) }).then((r) => r.json()).catch(() => ({}))).images ?? {} : {};
const want = unpictured.filter((d) => !rung1[d.gtin]);

// Only Shufersal's deals get a page read here. The other chains' pages are other recipes, and this
// file says so rather than guessing (docs/backlog/store-recipe-fixer.md).
const learned = {};
let tried = 0;
for (const d of want.filter((x) => x.chainName === 'שופרסל')) {
  for (const code of shufersalCodes(d.gtin)) {
    tried++;
    const res = await fetch(`https://www.shufersal.co.il/online/he/p/P_${code}`, { method: 'GET', headers: { 'user-agent': UA, 'accept-language': 'he-IL' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const page = res?.ok ? readShufersalPage(await res.text(), code) : null;
    await new Promise((r) => setTimeout(r, 400)); // one page at a time, like a person
    if (!page) continue;
    const match = sameProduct(d.name, page.title);
    console.log(`${match ? 'kept' : 'skip'}  ${d.gtin} P_${code}  deal "${d.name}"  page "${page.title}"`);
    if (match) { learned[d.gtin] = page.image; break; }
  }
}
const kept = Object.keys(learned).length;
const others = want.filter((x) => x.chainName !== 'שופרסל').length;
if (kept && !DRY) {
  const r = await fetch(`${API}/households/${hid}/images/learned`, { method: 'POST', headers: h, body: JSON.stringify({ images: learned }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  console.log(`chain-images: ${deals.length} deals, ${unpictured.length} without a picture, rung 1 found ${Object.values(rung1).filter(Boolean).length}; Shufersal pages ${tried} read, ${kept} kept → API ${JSON.stringify(r)}; ${others} from other chains left to rung 1`);
} else {
  console.log(`chain-images${DRY ? ' (dry run)' : ''}: ${deals.length} deals, ${unpictured.length} without a picture, rung 1 found ${Object.values(rung1).filter(Boolean).length}; Shufersal pages ${tried} read, ${kept} would be kept; ${others} from other chains left to rung 1`);
}
