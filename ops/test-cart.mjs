/**
 * The shopper agent's test cart: a family of five, a real week, about 35 lines, ₪800–1200.
 * It walks the whole product through the live API as that family and checks what a person
 * would check:
 *   - the list resolves (most lines get a product, a barcode where the catalogue has one)
 *   - the compare offers a cheapest option, a fastest one, and both are explained
 *   - a split across two stores is offered when it saves money, and only then
 *   - a store that lacks a line is offered with a named substitute or as a split leg, never dropped silently
 *   - the winning total is in the expected range, coverage is near-complete
 *   - the in-store column has branches when the household has an address
 *   - the cart lines for the winning store carry barcodes or links (what the phone needs to fill the cart)
 *
 *   node ops/test-cart.mjs [--json out.json]        (test family from ~/.kaniti/e2e.env)
 * Exit 1 on any failed check. Nothing is ordered; the store carts are the phone's job (the sim covers that).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';
const jsonAt = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

// A week for five: staples, fresh, dairy, protein (salmon included on purpose — not every store stocks it), snacks, cleaning.
const CART = [
  ['חלב 3% 1 ליטר', 4], ['קוטג\' 5%', 3], ['גבינה צהובה פרוסה', 2], ['יוגורט תות', 6], ['חמאה', 2], ['ביצים L', 2],
  ['לחם אחיד פרוס', 3], ['פיתות', 2], ['חלה', 1], ['קורנפלקס', 2], ['שיבולת שועל', 1],
  ['אורז בסמטי', 2], ['פסטה פנה', 3], ['קמח לבן', 1], ['סוכר', 1], ['שמן זית', 1], ['שמן קנולה', 1], ['רוטב עגבניות', 3], ['טונה בשמן', 6], ['חומוס', 2], ['טחינה גולמית', 1],
  ['חזה עוף', 2], ['פילה סלמון', 1], ['בשר טחון', 1], ['נקניקיות עוף', 1],
  ['עגבניות', 2], ['מלפפונים', 2], ['בננות', 2], ['תפוחים', 2], ['בצל', 1], ['תפוחי אדמה', 1],
  ['במבה', 4], ['ביסלי', 4], ['שוקולד פרה', 3], ['מים מינרליים 6', 2],
  ['נייר טואלט 32', 1], ['אבקת כביסה', 1], ['סבון כלים', 1], ['שקיות אשפה', 1],
].map(([query, qty], i) => ({ id: `t${i}`, query, packQty: qty }));

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok ' : 'BAD'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const money = (a) => `₪${(a / 100).toFixed(0)}`;

const t0 = Date.now();
const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
const token = auth.AuthenticationResult?.IdToken;
if (!token) { console.log('BAD  auth'); process.exit(1); }
const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const me = await fetch(`${API}/me`, { headers: h }).then((r) => r.json());
const hid = me.households?.[0]?.id;
check('signed in as the test family', !!hid, hid);

// 1. Resolve: what the app does as the list is typed.
const resolved = await fetch(`${API}/households/${hid}/resolve`, { method: 'POST', headers: h, body: JSON.stringify({ lines: CART }) }).then((r) => r.json()).catch(() => ({}));
const choices = resolved.choices ?? {};
const withProduct = CART.filter((l) => choices[l.id]?.chosen || choices[l.id]?.productId || choices[l.id]?.gtin).length;
check('lines resolve to products', withProduct >= CART.length * 0.8, `${withProduct}/${CART.length}`);
const lines = CART.map((l) => { const c = choices[l.id]; const gtin = c?.chosen?.gtin ?? c?.gtin; return gtin ? { ...l, gtin } : l; });

// 2. Quote: the compare screen.
const res = await fetch(`${API}/households/${hid}/quote`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) });
const q = await res.json().catch(() => ({}));
check('quote answers', res.status === 200 && Array.isArray(q.options), `HTTP ${res.status}, ${q.options?.length ?? 0} options, ${q.rejected?.length ?? 0} rejected, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const options = q.options ?? [];
const best = options[0];
check('a cheapest option exists', !!best, best ? `${best.label} ${money(best.cashCost)}` : 'none');
check('the cheapest total is a real week for five (₪800–1200)', best && best.cashCost >= 80_000 && best.cashCost <= 120_000, best ? money(best.cashCost) : '-');
check('the cheapest option covers the list', best && best.coverageRatio >= 0.9, best ? `${Math.round(best.coverageRatio * 100)}% · missing ${best.unpricedLineIds.length}` : '-');
check('every option is explained', options.every((o) => o.explanation?.reason && typeof o.explanation.savingVsBaseline === 'number'), `${options.length} options`);

// Fast: at least one single-store option with a live ETA, or the chains' windows are declared.
const etas = q.etas ?? {};
const live = Object.values(etas).filter((e) => e.kind === 'live');
check('fast is measured (live ETAs present or windows declared)', Object.keys(etas).length > 0, `${live.length} live, ${Object.keys(etas).length - live.length} window`);

// Split: offered when it saves, with two legs that each carry lines; never a split that saves nothing.
const split = options.find((o) => o.kind === 'split_delivered');
const singles = options.filter((o) => o.legs.length === 1 && o.kind !== 'drive' && o.kind !== 'pickup');
if (split) {
  check('the split saves against the best single store', singles.length === 0 || split.cashCost < Math.min(...singles.map((s) => s.cashCost)), `${money(split.cashCost)} vs ${singles.length ? money(Math.min(...singles.map((s) => s.cashCost))) : '-'}`);
  check('the split has two real legs', split.legs.length === 2 && split.legs.every((l) => l.lineIds.length > 0), split.legs.map((l) => `${l.brand} ${l.lineIds.length}`).join(' + '));
} else check('no split offered — only right if no second store beats the single by the threshold', singles.length >= 1, `${singles.length} single-store options`);

// Substitutes: a store that lacks lines shows named substitutes rather than vanishing.
const subLines = Object.values(q.storefrontLines ?? {}).flatMap((m) => Object.values(m)).filter((l) => l.substituted);
const coverageRejected = (q.rejected ?? []).filter((r) => r.code === 'coverage');
check('stores lacking lines are handled (substitute named or split leg), not dropped silently', coverageRejected.length === 0 || subLines.length > 0 || !!split, `${coverageRejected.length} coverage-rejected, ${subLines.length} substituted lines`);

// In-store: the household has an address, so branches must be there (or honestly pending).
check('in-store prices present', q.drive && (q.drive.status === 'ready' ? q.drive.branches.length > 0 : q.drive.status === 'pending'), q.drive ? `${q.drive.status} (${q.drive.branches?.length ?? 0})` : 'missing');

// The phone's cart: every line of the winner has a barcode or a link.
if (best) {
  const sl = q.storefrontLines?.[best.legs[0].storefrontId] ?? {};
  const fillable = best.legs[0].lineIds.filter((id) => sl[id]?.gtin || sl[id]?.link).length;
  check('the winning cart is fillable on the phone (barcode or link per line)', fillable >= best.legs[0].lineIds.length * 0.9, `${fillable}/${best.legs[0].lineIds.length}`);
}

const bad = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), ok: bad.length === 0, checks, best: best ? { label: best.label, cashCost: best.cashCost, coverage: best.coverageRatio } : null, split: split ? { cashCost: split.cashCost, legs: split.legs.map((l) => `${l.brand}:${l.lineIds.length}`) } : null };
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 1));
console.log(bad.length ? `\n${bad.length} check(s) failed: ${bad.map((c) => c.name).join('; ')}` : '\nthe test cart passes end to end');
process.exit(bad.length ? 1 : 0);
