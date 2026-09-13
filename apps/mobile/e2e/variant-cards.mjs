/**
 * The add flow shows variants, not a wall of milk (docs/design/item-identity.md; promises 1, 4, 7).
 *
 * The bug this holds: every tap in the add flow used to pin a barcode, so "חלב" meant one brand's
 * carton at every store — and a 1 ℓ carton priced against a 2 ℓ bottle looked like a saving. The
 * screen's decisions live in `src/lib/choice.ts`; this lab runs those very functions over the real
 * catalogue for the test family and fails when one of them would put something untrue on a phone.
 *
 *   node apps/mobile/e2e/variant-cards.mjs [query ...]
 *
 * GET only — nothing is added, ordered or signed into. Exit 1 on any BAD.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { groupIntoVariants } from '../../../packages/domain/src/variant.ts';
import { brandGroups, carriedNearby, choiceOf, lineFromHit, lineFromVariant, soleProduct, spanOf, variantWords } from '../src/lib/choice.ts';

let bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'BAD '} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) bad += 1; };
const shekel = (a) => (a === undefined ? '—' : `₪${(a / 100).toFixed(2)}`);

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';

const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth'); process.exit(1); }
const h = { authorization: `Bearer ${token}` };
const hid = (await fetch(`${API}/me`, { headers: h }).then((r) => r.json())).households?.[0]?.id;
if (!hid) { console.log('BAD  no household'); process.exit(1); }

// The categories the design names: a fat percentage, a count, a grind, and a percentage again.
const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : ['חלב', 'ביצים', 'קפה', 'שמנת'];
let served = 0;

for (const q of QUERIES) {
  const r = await fetch(`${API}/households/${hid}/search?q=${encodeURIComponent(q)}`, { headers: h }).then((x) => x.json()).catch(() => null);
  const products = r?.products ?? [];
  if (products.length === 0) { console.log(`\n— ${q}: the catalogue answered nothing; the line goes on as typed (skipped)`); continue; }
  served += 1;

  // When the API has not been deployed with the grouping yet, group here with the very same
  // domain function the API calls: the screen is proven either way, and the note says which.
  const variants = r.variants ?? groupIntoVariants(products).map((v) => ({ base: v.base, attrs: v.attrs, ...(v.size ? { size: v.size } : {}), brandCount: v.brandCount, priceMin: v.priceMin, priceMax: v.priceMax, products: v.candidates }));
  console.log(`\n— ${q}: ${products.length} product(s) → ${variants.length} card(s)${r.variants ? '' : '  (grouped here; the API has not shipped `variants` to this stage yet)'}`);

  check(variants.length > 0, `${q}: the family is shown something`, `${variants.length} card(s)`);
  check(variants.length <= products.length, `${q}: grouping only collapses, never invents`, `${variants.length} ≤ ${products.length}`);
  // Nothing disappears silently (promise 1): every product the catalogue answered is behind a card.
  const behind = new Set(variants.flatMap((v) => v.products.map((p) => p.productId)));
  check(behind.size === new Set(products.map((p) => p.productId)).size, `${q}: every product is still reachable behind a card`, `${behind.size} of ${products.length}`);

  for (const v of variants.slice(0, 6)) {
    const sole = soleProduct(v);
    const span = spanOf(v.products);
    const words = variantWords(v);
    const here = carriedNearby(v);
    console.log(`     ${sole ? sole.name : words}  ·  ${sole ? sole.brand ?? '—' : `${v.brandCount} מותגים`}  ·  ${here ? `${shekel(span?.min)}–${shekel(span?.max)}` : 'אין בחנויות שמגיעות אליכם'}`);

    if (sole) {
      // One product behind the card means there is nothing to choose: the product *is* the choice.
      check(choiceOf(lineFromHit(sole)) === 'pinned', `${q}: a one-product card pins that product`, sole.name);
      continue;
    }
    const line = lineFromVariant(v);
    // The whole point: a card must not decide brand for the family.
    check(choiceOf(line) === 'any', `${q}: "${words}" goes on the list as כל מותג`, `gtin=${line.gtin ?? 'none'} brand=${line.brand ?? 'none'}`);
    // Promise 4: only query/gtin/brand/quantity reach the quote, so a card that drops its size
    // invites a store to price the bigger pack and call the difference a saving.
    check(!v.size || /\d/.test(line.query), `${q}: "${words}" carries its pack size into the line`, line.query);
    // A card claiming N brands must have N brands to show when the chip is tapped.
    const gs = brandGroups(v.products);
    check(gs.length === v.brandCount, `${q}: "${words}" offers the ${v.brandCount} brand(s) it counts`, gs.map((g) => g.brand).join(', ') || 'none');
    // Every row in the sheet must be buyable as something: a brand with no product to pin is a dead row.
    check(gs.every((g) => g.cheapest), `${q}: every brand row has a product behind it`);
    // Cheapest brand first — the family reads the answer, not a list.
    const mins = gs.map((g) => g.priceMin ?? Infinity);
    check(mins.every((m, i) => i === 0 || mins[i - 1] <= m), `${q}: "${words}" lists brands cheapest first`, gs.map((g) => `${g.brand} ${shekel(g.priceMin)}`).join(' · '));
  }
}

check(served > 0, 'the catalogue answered at least one query');
console.log(bad === 0 ? `\nok   ${QUERIES.length} quer(ies), no card would mislead` : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
