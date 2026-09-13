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
// --short: the other real list — a top-up of eight lines — where "only one option" is common and must be explained.
const SHORT = process.argv.includes('--short');

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
const TOPUP = [['חלב 3% 1 ליטר', 2], ['לחם אחיד פרוס', 1], ['ביצים L', 1], ['פילה סלמון', 1], ['עגבניות', 1], ['מלפפונים', 1], ['במבה', 2], ['נייר טואלט 32', 1]].map(([query, qty], i) => ({ id: `s${i}`, query, packQty: qty }));
const LIST = SHORT ? TOPUP : CART;

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

// Promise 7 — memory: seed a confirmed brand (olive oil, already on the list) and a forgotten
// habit (instant coffee, never on this list) before the compare runs, so the compare itself is
// the proof — not a side call. Both are the test family's own memory, no store touched.
const OIL = { phrase: 'שמן זית', gtin: '7290017334479', productName: 'שמן זית ארומה פירותית750', brand: 'אליעד' };
const COFFEE = { phrase: 'קפה נמס', gtin: '7290000072753', productName: "קפה נמס טייסטרס צ'ויס Taster's Choice" };
if (!SHORT && hid) {
  await fetch(`${API}/households/${hid}/memory/confirm`, { method: 'POST', headers: h, body: JSON.stringify(OIL) });
  const mem = await fetch(`${API}/households/${hid}/memory`, { headers: h }).then((r) => r.json()).catch(() => ({ products: {} }));
  const coffeeKnown = Object.values(mem.products ?? {}).find((p) => p.gtin === COFFEE.gtin);
  // Two purchases are enough to count as "usual" (suggestMissing's minOrderCount); seed once, never regrow it.
  if (!coffeeKnown || coffeeKnown.orderCount < 2) {
    await fetch(`${API}/households/${hid}/memory/shop`, { method: 'POST', headers: h, body: JSON.stringify({ bought: [COFFEE, COFFEE] }) });
  }
}

// 1. Resolve: what the app does as the list is typed.
// Same one-retry rule as the quote below: a gateway 5xx is a bad minute, not a verdict on the
// product - but production has shown this landing on 0/39 with no retry at all, so it gets one now.
const t1 = Date.now();
let rres = await fetch(`${API}/households/${hid}/resolve`, { method: 'POST', headers: h, body: JSON.stringify({ lines: LIST }) });
if (rres.status >= 500) { await new Promise((r) => setTimeout(r, 8000)); rres = await fetch(`${API}/households/${hid}/resolve`, { method: 'POST', headers: h, body: JSON.stringify({ lines: LIST }) }); }
const resolved = await rres.json().catch(() => ({}));
const choices = resolved.choices ?? {};
const withProduct = LIST.filter((l) => choices[l.id]?.chosen || choices[l.id]?.productId || choices[l.id]?.gtin).length;
check('lines resolve to products', rres.status === 200 && withProduct >= LIST.length * 0.8, `HTTP ${rres.status}, ${withProduct}/${LIST.length}, ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const lines = LIST.map((l) => { const c = choices[l.id]; const gtin = c?.chosen?.gtin ?? c?.gtin; return gtin ? { ...l, gtin } : l; });

// 2. Quote: the compare screen.
// A 5xx from the gateway (a slow provider minute) is retried once before it counts: the check is about the product, not one bad minute.
const t2 = Date.now();
let res = await fetch(`${API}/households/${hid}/quote`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) });
if (res.status >= 500) { await new Promise((r) => setTimeout(r, 8000)); res = await fetch(`${API}/households/${hid}/quote`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) }); }
const q = await res.json().catch(() => ({}));
const quoteSeconds = (Date.now() - t2) / 1000;
check('quote answers', res.status === 200 && Array.isArray(q.options), `HTTP ${res.status}, ${q.options?.length ?? 0} options, ${q.rejected?.length ?? 0} rejected, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// API Gateway cuts a REST integration at 29s (docs/CONTEXT.md); a quote landing near that is the
// family one bad provider-minute away from the 503 tonight's report was ("39-line quote 503 after
// 59s") - catch the near miss before it becomes the outage.
check('the compare itself answers well inside the gateway cutoff', quoteSeconds < 26, `${quoteSeconds.toFixed(1)}s (cutoff ~29s)`);
const options = q.options ?? [];
const best = options[0];
check('a cheapest option exists', !!best, best ? `${best.label} ${money(best.cashCost)}` : 'none');
if (!SHORT) check('the cheapest total is a real week for five (₪800–1200)', best && best.cashCost >= 80_000 && best.cashCost <= 120_000, best ? money(best.cashCost) : '-');
else check('the top-up total is plausible (₪60–250)', best && best.cashCost >= 6_000 && best.cashCost <= 25_000, best ? money(best.cashCost) : '-');
check('the cheapest option covers the list', best && best.coverageRatio >= 0.9, best ? `${Math.round(best.coverageRatio * 100)}% · missing ${best.unpricedLineIds.length}` : '-');
check('every option is explained', options.every((o) => o.explanation?.reason && typeof o.explanation.savingVsBaseline === 'number'), `${options.length} options`);

// Promise 4 — numbers are honest: an option's legs add up to its cash; the cheapest is the lowest cash.
check('every option adds up (legs items + fees = cash)', options.every((o) => Math.abs(o.legs.reduce((n, l) => n + l.itemsSubtotal + l.deliveryFee, 0) + (o.travel ? o.travel.fuelCost + o.travel.parkingCost : 0) - o.cashCost) <= 1), `${options.length} options`);
const comparable = (o) => o.cashCost + (o.missingEstimate === undefined ? (o.unpricedLineIds.length ? 10_000_000 : 0) : o.missingEstimate);
check('the first option is the cheapest once completed (cash + the cheapest top-up of what it misses)', !best || options.every((o) => comparable(o) >= comparable(best)), best ? `${money(best.cashCost)}${best.missingEstimate ? ' + ' + money(best.missingEstimate) + ' to complete' : ''}` : '-');
// Promise 1 — nothing disappears silently: every rejected store carries a reason and its numbers.
check('every rejected store has a reason', (q.rejected ?? []).every((r) => r.code && r.reason && typeof r.pricedLines === 'number'), `${q.rejected?.length ?? 0} rejected`);
// Promise 2 — "only one option" must be explainable: with several stores delivering, either more options exist
// or every other store is rejected for a stated reason (coverage/minimum) and no split cleared the threshold.
check('one option only when explained', options.length >= 2 || ((q.rejected ?? []).length > 0 && (q.rejected ?? []).every((r) => r.code === 'coverage' || r.code === 'minimum')), `${options.length} options, ${(q.rejected ?? []).length} rejected`);

// Fast: at least one single-store option with a live ETA, or the chains' windows are declared.
const etas = q.etas ?? {};
const live = Object.values(etas).filter((e) => e.kind === 'live');
check('fast is measured (live ETAs present or windows declared)', Object.keys(etas).length > 0, `${live.length} live, ${Object.keys(etas).length - live.length} window`);

// Split: offered when it saves, with two legs that each carry lines; never a split that saves nothing.
const split = options.find((o) => o.kind === 'split_delivered');
const singles = options.filter((o) => o.legs.length === 1 && o.kind !== 'drive' && o.kind !== 'pickup');
if (split) {
  check('the split beats every single store once each is completed', singles.length === 0 || comparable(split) <= Math.min(...singles.map(comparable)), `${money(split.cashCost)} vs ${singles.length ? money(Math.min(...singles.map(comparable))) : '-'} completed`);
  check('the split has two real legs', split.legs.length === 2 && split.legs.every((l) => l.lineIds.length > 0), split.legs.map((l) => `${l.brand} ${l.lineIds.length}`).join(' + '));
  const mins = Object.fromEntries((q.rejected ?? []).filter((r) => r.minimumOrder).map((r) => [r.storefrontId, r.minimumOrder]));
  check('each split leg clears its store minimum where one is known', split.legs.every((l) => !mins[l.storefrontId] || l.itemsSubtotal >= mins[l.storefrontId]), split.legs.map((l) => `${l.brand} ${money(l.itemsSubtotal)}${mins[l.storefrontId] ? ' (min ' + money(mins[l.storefrontId]) + ')' : ''}`).join(' + '));
} else check('no split offered — only right if no second store beats the single by the threshold', singles.length >= 1, `${singles.length} single-store options`);

// Substitutes: a store that lacks lines shows named substitutes rather than vanishing.
const subLines = Object.values(q.storefrontLines ?? {}).flatMap((m) => Object.values(m)).filter((l) => l.substituted);
const coverageRejected = (q.rejected ?? []).filter((r) => r.code === 'coverage');
check('stores lacking lines are handled (substitute named or split leg), not dropped silently', coverageRejected.length === 0 || subLines.length > 0 || !!split, `${coverageRejected.length} coverage-rejected, ${subLines.length} substituted lines`);

// Promise 3 — a substitute is the same kind of product: it shares a word with the line it replaces.
const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
// Hebrew plural and gender endings fall away (עגבניות ~ עגבניה), the same rule the picker uses.
const finals = (w) => w.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
const stem = (w) => { const x = finals(w); return x.length > 4 ? x.replace(/(יות|ות|ימ|ינ|יה|ה|ת)$/u, '') : x; }; // endings written with regular letters: finals are normalised first
const same = (a, b) => { if (a === b) return true; const [x, y] = [stem(a), stem(b)]; return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(y) || y.startsWith(x)); };
const badSubs = Object.values(q.storefrontLines ?? {}).flatMap((m) => Object.entries(m)).filter(([id, l]) => l.substituted && l.reason && /→/.test(l.reason) && l.swapBy !== 'store').filter(([id, l]) => { const orig = norm(LIST.find((x) => x.id === id)?.query ?? ''); const alt = norm(l.productName); return orig.length && !orig.some((w) => alt.some((v) => same(v, w))); });
check('substitutes are the same kind of product', badSubs.length === 0, badSubs.length ? badSubs.slice(0, 3).map(([, l]) => l.reason).join('; ') : 'all share a word with the line');
// Promise 4 — in-store rows compare like with like: a partial branch never claims a saving against the full cart.
const driveRows = q.drive?.branches ?? [];
check('in-store rows compare the same lines', driveRows.every((b) => b.coveredLines === b.totalLines || b.sameLines || b.coveredLines === 0), driveRows.map((b) => `${b.brand} ${b.coveredLines}/${b.totalLines}${b.sameLines ? ' vs ' + b.sameLines.brand : ''}`).join('; ') || 'no rows');

// In-store: the household has an address, so branches must be there (or honestly pending).
check('in-store prices present', q.drive && (q.drive.status === 'ready' ? q.drive.branches.length > 0 : q.drive.status === 'pending'), q.drive ? `${q.drive.status} (${q.drive.branches?.length ?? 0})` : 'missing');

// The phone's cart: every line of the winner has a barcode or a link.
if (best) {
  const sl = q.storefrontLines?.[best.legs[0].storefrontId] ?? {};
  const fillable = best.legs[0].lineIds.filter((id) => sl[id]?.gtin || sl[id]?.link).length;
  check('the winning cart is fillable on the phone (barcode or link per line)', fillable >= best.legs[0].lineIds.length * 0.9, `${fillable}/${best.legs[0].lineIds.length}`);
}
// A picture on every line of a real list: a drawn glyph where a photograph belongs is the commonest
// "the app looks unfinished". quotedLines is the winner's cart as the phone renders it.
//
// Where the picture comes from matters. The API answers from public sources (the chain's image host
// by barcode, Open Food Facts); the chains' own catalogues answer a phone and block a data centre
// (ADR 0011), so the phone fetches those and teaches the API. This check is run from a Mac, which
// the chains treat as a person, so it can prove BOTH halves: what the API already has, and that the
// phone's own sources cover the rest. A line neither can picture is the real failure.
const quotedLines = Object.values(q.quotedLines ?? {});
const pictured = quotedLines.filter((l) => l.imageUrl);
const unpictured = quotedLines.filter((l) => !l.imageUrl);

/** The phone's ladder, as `apps/mobile/src/lib/storeImages.ts` runs it: the chain's catalogue, then Shufersal. */
async function pictureFromAChain(name) {
  if (!name || name.trim().length < 2) return null;
  try {
    const r = await fetch('https://www.rami-levy.co.il/api/catalog?', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json' },
      body: JSON.stringify({ q: name, size: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    const d = r.ok ? await r.json() : null;
    const path = (d?.data ?? []).map((x) => x.images?.small ?? x.images?.trim).find(Boolean);
    if (path) return path.startsWith('http') ? path : `https://img.rami-levy.co.il${path}`;
  } catch { /* the second rung */ }
  try {
    const r = await fetch(`https://www.shufersal.co.il/online/he/search/results?q=${encodeURIComponent(`${name}:relevance`)}&limit=1`, {
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(8000),
    });
    const d = r.ok ? await r.json() : null;
    return d?.results?.[0]?.images?.find((i) => i.format === 'product' || i.format === 'thumbnail')?.url ?? null;
  } catch {
    return null;
  }
}

const fromChain = await Promise.all(unpictured.map((l) => pictureFromAChain(l.productName)));
const coveredByPhone = fromChain.filter(Boolean).length;
const nowhere = unpictured.filter((_, i) => !fromChain[i]).map((l) => l.productName ?? l.gtin ?? '?');
check(
  'every line of the real list can show a picture (the API\'s, or the chains\' own from the phone)',
  quotedLines.length > 0 && nowhere.length === 0,
  `${pictured.length} from the API, ${coveredByPhone} the phone fetches` + (nowhere.length ? ` · no picture anywhere: ${nowhere.join(', ')}` : ''),
);

// Promise 7 — it remembers the family: a confirmed brand wins the line in this very compare,
// and a habit missing from the list surfaces as a suggestion, not silence.
if (!SHORT) {
  const oilLine = LIST.find((l) => l.query === OIL.phrase);
  const oilQuoted = q.lines?.find((l) => l.id === oilLine?.id);
  // The script mirrors the phone: resolve first (this is where memory is actually read from a bare
  // query), then quote with the gtin resolve already chose — so by the time quote sees the line it
  // is an explicit request, not a memory lookup of its own, and quote's own fromMemory is rightly empty.
  const oilResolved = oilLine && choices[oilLine.id];
  check('a confirmed brand preference changes the compare', !!oilResolved && oilResolved.source === 'memory' && oilResolved.chosen?.gtin === OIL.gtin && oilQuoted?.gtin === OIL.gtin, oilResolved ? `${oilResolved.chosen?.brand ?? '?'} ${oilResolved.chosen?.gtin} (source ${oilResolved.source}) → quoted ${oilQuoted?.gtin}` : 'no line');
  const suggestions = q.suggestions ?? [];
  const forgotten = suggestions.find((s) => s.preference?.gtin === COFFEE.gtin);
  check('a forgotten habit is suggested from memory, not a generic list', !!forgotten, forgotten ? `${forgotten.preference.productName} (${forgotten.reason}, ${forgotten.preference.orderCount}x)` : `${suggestions.length} suggestion(s), none matched`);
}

const bad = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), ok: bad.length === 0, checks, best: best ? { label: best.label, cashCost: best.cashCost, coverage: best.coverageRatio } : null, split: split ? { cashCost: split.cashCost, legs: split.legs.map((l) => `${l.brand}:${l.lineIds.length}`) } : null };
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 1));
console.log(bad.length ? `\n${bad.length} check(s) failed: ${bad.map((c) => c.name).join('; ')}` : `\nthe ${SHORT ? 'top-up' : 'test'} cart passes end to end`);
process.exit(bad.length ? 1 : 0);
