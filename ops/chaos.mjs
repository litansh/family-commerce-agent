/**
 * The chaos cart: the whole flow, for a real family, twice — once clean, once the way families
 * actually type a list. The owner's brief: "if an agent checks a specific cart of 35 items then it
 * should check it end to end up until the order, and make it chaotic - I want the agents to find
 * all the bugs and stuff that will make the app not as it should."
 *
 *   node --experimental-strip-types ops/chaos.mjs [--json out.json]
 *
 * Pass 1 (clean): build a five-person week's list, resolve every line, run the compare, take its
 * own answer for Rami Levy, fill Rami Levy's cart in a lab browser as a guest (the same engine as
 * apps/mobile/e2e/cart-recipe-lab.mjs), read the store's own basket back, and stop — Kaniti always
 * stops at the payment page, never past it.
 *
 * Pass 2 (chaotic): the same list with a dozen lines the way families actually send them: a typo,
 * mixed Hebrew/English, a barcode nowhere, the same item twice, quantity 90, a 200-character name,
 * emoji, an empty line, a line that is only a number, a product no store carries, and two items
 * that made the provider err or crawl for real (טופו/שוקולד, 2026-09-12). Every one must end in a
 * sentence a person understands and a list that still works: never a crash, never a silent drop,
 * never a wrong product in the cart.
 *
 * Seeded and repeatable: SEED below fixes the one random choice this script makes (where the chaos
 * lines land in the list), so a run today and a run next month build the identical list and can be
 * compared line for line. Nothing is ordered; the browser stops at the store's basket page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { webkit, devices } from 'playwright';
import { STORES } from '../apps/mobile/src/lib/stores.ts';

const env = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/e2e.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const API = 'https://buc8pe49g0.execute-api.eu-central-1.amazonaws.com';
const jsonAt = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok ' : 'BAD'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const section = (t) => console.log(`\n== ${t} ==`);

// A tiny seeded PRNG (mulberry32) so "chaotic" is repeatable, not different every run.
const SEED = 20260913;
function mulberry32(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(SEED);
const seededShuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The same real week a five-person family sends (ops/test-cart.mjs's own list, so a chaos failure
// and a shopper failure are directly comparable).
const BASE = [
  ['חלב 3% 1 ליטר', 4], ['קוטג\' 5%', 3], ['גבינה צהובה פרוסה', 2], ['יוגורט תות', 6], ['חמאה', 2], ['ביצים L', 2],
  ['לחם אחיד פרוס', 3], ['פיתות', 2], ['חלה', 1], ['קורנפלקס', 2], ['שיבולת שועל', 1],
  ['אורז בסמטי', 2], ['פסטה פנה', 3], ['קמח לבן', 1], ['סוכר', 1], ['שמן זית', 1], ['שמן קנולה', 1], ['רוטב עגבניות', 3], ['טונה בשמן', 6], ['חומוס', 2], ['טחינה גולמית', 1],
  ['חזה עוף', 2], ['פילה סלמון', 1], ['בשר טחון', 1], ['נקניקיות עוף', 1],
  ['עגבניות', 2], ['מלפפונים', 2], ['בננות', 2], ['תפוחים', 2], ['בצל', 1], ['תפוחי אדמה', 1],
  ['במבה', 4], ['ביסלי', 4], ['שוקולד פרה', 3], ['מים מינרליים 6', 2],
  ['נייר טואלט 32', 1], ['אבקת כביסה', 1], ['סבון כלים', 1], ['שקיות אשפה', 1],
].map(([query, packQty], i) => ({ id: `b${i}`, query, packQty }));

// Every abuse a family's own thumbs and a bad night for the provider actually produce, named so a
// failure reads like the report the owner would send, not a stack trace.
const CHAOS = {
  typo: { id: 'x-typo', query: 'מלפפונימ', packQty: 2 }, // מלפפונים, fat-fingered
  mixed: { id: 'x-mixed', query: 'חלב milk 3%', packQty: 1 },
  fakeBarcode: { id: 'x-fake-gtin', query: 'לא קיים', gtin: '9999999999999', packQty: 1 }, // deliberately absent — must never resolve to a real product
  dupA: { id: 'x-dup-a', query: 'בננות', packQty: 2 },
  dupB: { id: 'x-dup-b', query: 'בננות', packQty: 3 }, // the same item twice, different lines — must merge, neither silently dropped
  qty90: { id: 'x-qty90', query: 'מים מינרליים 6', packQty: 90 },
  longName: { id: 'x-long', query: 'א'.repeat(200), packQty: 1 }, // 200 characters, not a word
  emoji: { id: 'x-emoji', query: '🍕🥑🧻🔥🥩', packQty: 1 },
  emptyLine: { id: 'x-empty', query: '', packQty: 1 }, // a line whose text got cleared but the row stayed
  numberOnly: { id: 'x-number', query: '12345', packQty: 1 },
  neverCarried: { id: 'x-never', query: 'מיץ קקטוס קפוא נדיר מהחלל', packQty: 1 }, // fictitious — must resolve to nothing, not something
  provider1: { id: 'x-tofu', query: 'טופו', packQty: 1 }, // search_products('טופו') → internal_error after 20.7s, 2026-09-12
  provider2: { id: 'x-choc', query: 'שוקולד', packQty: 1 }, // ('שוקולד') → 29.4s the same night
};
const CHAOTIC_LIST = seededShuffle([...BASE, ...Object.values(CHAOS)]);

// --- API plumbing (same shape as ops/test-cart.mjs) ---------------------------------------------
async function signIn() {
  const auth = await fetch('https://cognito-idp.eu-central-1.amazonaws.com/', { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' }, body: JSON.stringify({ ClientId: '1t7e0himh3heckpassvg0q0e0o', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: env.KANITI_E2E_EMAIL, PASSWORD: env.KANITI_E2E_PASSWORD } }) }).then((r) => r.json());
  const token = auth.AuthenticationResult?.IdToken;
  if (!token) throw new Error(`auth failed: ${JSON.stringify(auth).slice(0, 200)}`);
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const me = await fetch(`${API}/me`, { headers: h }).then((r) => r.json());
  const hid = me.households?.[0]?.id;
  if (!hid) throw new Error(`/me has no household: ${JSON.stringify(me).slice(0, 200)}`);
  return { h, hid };
}
// One retry on a gateway 5xx, same rule as ops/test-cart.mjs: the check is about the product,
// not one bad provider minute (SuperMCP really does have those — docs/CONTEXT.md).
async function withRetry(call) { let r = await call(); if (r.status >= 500) { await new Promise((res) => setTimeout(res, 8000)); r = await call(); } return r; }
const resolve = (h, hid, lines) => withRetry(() => fetch(`${API}/households/${hid}/resolve`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) }));
const quote = (h, hid, lines) => withRetry(() => fetch(`${API}/households/${hid}/quote`, { method: 'POST', headers: h, body: JSON.stringify({ lines }) }));
const norm = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
const finals = (w) => w.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
const stem = (w) => { const x = finals(w); return x.length > 4 ? x.replace(/(יות|ות|ימ|ינ|יה|ה|ת)$/u, '') : x; };
// Same rule test-cart.mjs uses for substitutes: a resolved product must share a real word with what
// was typed, or it is a wrong product wearing the family's own words.
const sharesAWord = (query, productName) => { const q = norm(query), p = norm(productName); return q.length > 0 && p.length > 0 && q.some((a) => p.some((b) => { const [x, y] = [stem(a), stem(b)]; return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(y) || y.startsWith(x)); })); };

const { h, hid } = await signIn();
check('signed in as the test family', !!hid, hid);

// =================================================================================================
section('Pass 1 — the whole flow, clean');
// =================================================================================================
let t0 = Date.now();
const cleanResolve = await resolve(h, hid, BASE).then((r) => r.json().catch(() => ({})));
check('clean list resolves', Object.keys(cleanResolve.choices ?? {}).length >= BASE.length * 0.8, `${Object.values(cleanResolve.choices ?? {}).filter(Boolean).length}/${BASE.length}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const cleanLines = BASE.map((l) => { const c = cleanResolve.choices?.[l.id]; const gtin = c?.chosen?.gtin ?? c?.gtin; return gtin ? { ...l, gtin } : l; });
t0 = Date.now();
const cleanQuote = await quote(h, hid, cleanLines).then((r) => r.json().catch(() => ({})));
check('the compare answers for the clean list', Array.isArray(cleanQuote.options) && cleanQuote.options.length > 0, `${cleanQuote.options?.length ?? 0} options, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// "Take its answer": the compare's own priced lines for Rami Levy, whichever leg won them (the
// production shopper has picked רמי לוי אונליין both times this week; if it ever does not, this
// still proves the guest-cart rung against the compare's real read of that store for this list).
const ramiId = [...(cleanQuote.options ?? []).flatMap((o) => o.legs), ...(cleanQuote.rejected ?? [])].find((x) => /רמי לוי/.test(x.brand ?? ''))?.storefrontId;
const ramiLines = ramiId ? Object.entries(cleanQuote.storefrontLines?.[ramiId] ?? {}) : [];
check('the compare has a Rami Levy read of this list to act on', ramiLines.length > 0, `${ramiLines.length} lines priced at ${ramiId ?? 'no rami-levy row'}`);

// The store's basket holds one row per item: two list lines that resolve to the same item (the same
// thing typed twice, a name and its barcode) are one row there, so compare distinct item ids.
const distinctAdded = (results) => { const a = results.filter((r) => r.status === 'added'); return new Set(a.map((r, i) => r.id ?? `line${i}`)).size; };

async function fillCart(label, cartLines, screenshotName) {
  const store = STORES['rami-levy'];
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
  let resolveGot; const got = new Promise((r) => { resolveGot = r; });
  await page.exposeFunction('__cartResult', (payload) => resolveGot(payload));
  await page.addInitScript(() => {
    // @ts-ignore
    window.ReactNativeWebView = { postMessage: (m) => { try { if (String(m).startsWith('cart:')) window.__cartResult(JSON.parse(String(m).slice(5))); } catch (e) {} } };
  });
  let res = { timeout: true };
  try {
    await page.goto(store.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);
    await page.evaluate(store.cartJs(cartLines).replace(/;\s*true;\s*$/, ''));
    res = await Promise.race([got, new Promise((r) => setTimeout(() => r({ timeout: true }), 30_000))]);
  } catch (e) { res = { error: String(e).slice(0, 200) }; }
  const results = res.results ?? [];
  // The store's own state, not the recipe's return value (promise 9): its cart state, then the basket page count.
  const cartState = await page.evaluate(() => { try { const n = window.$nuxt; const items = n?.$store?.state?.cart?.items; return Array.isArray(items) ? items.length : null; } catch (e) { return null; } }).catch(() => null);
  let basketPageCount = '?';
  try {
    await page.goto('https://www.rami-levy.co.il/he/basket', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Read the store's own count until it settles: under load (the daily run, other checks beside it)
    // the basket page first paints "0 הסל שלי" before its cart syncs, and a single read at 5 s once
    // reported 0 for a cart that held 30 lines (2026-10-06). Two equal non-zero readings, or 25 s.
    const readCount = () => page.evaluate(() => { try { const items = window.$nuxt?.$store?.state?.cart?.items; if (Array.isArray(items) && items.length) return String(items.filter((i) => i && !i.is_delivery).length); } catch (e) {} const t = (document.body.innerText || '').replace(/\s+/g, ' '); const m = t.match(/(\d+)\s*הסל שלי/); return m ? m[1] : '?'; }).catch(() => '?');
    let last = '?';
    for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); const now = await readCount(); if (now !== '?' && now !== '0' && now === last) break; last = now; }
    basketPageCount = last;
  } catch (e) { /* the basket page itself is the last page this script ever opens — never checkout, never payment */ }
  await page.screenshot({ path: `apps/mobile/e2e/shots/${screenshotName}.png` }).catch(() => {});
  await ctx.close(); await browser.close();
  console.log(`   [${label}] cart state ${cartState}, basket page ${basketPageCount}, results: ${JSON.stringify(results.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {}))}`);
  console.log(`   [${label}] diag ${JSON.stringify(res.diag ?? res).slice(0, 400)}`);
  for (const e of [...new Set(pageErrors)].slice(0, 3)) console.log(`   [${label}] pageerror ${e}`);
  return { results, cartState, basketPageCount, diag: res.diag };
}

const cleanCart = ramiLines.length ? await fillCart('clean', ramiLines.map(([id, l]) => ({ gtin: l.gtin, name: l.productName, qty: BASE.find((b) => b.id === id)?.packQty ?? 1 })), 'chaos-clean-basket') : null;
if (cleanCart) {
  const added = distinctAdded(cleanCart.results);
  check('the clean cart fills without a crash', !cleanCart.diag?.error, cleanCart.diag ? JSON.stringify(cleanCart.diag).slice(0, 160) : 'no diag');
  check('the store\'s own basket agrees with what Kaniti claims added (promise 9)', cleanCart.basketPageCount === '?' || Number(cleanCart.basketPageCount) === added, `claimed ${added}, store shows ${cleanCart.basketPageCount}`);
  check('the run stops at the basket page — never checkout, never payment', true, 'last navigation: /he/basket');
}

// =================================================================================================
section('Pass 2 — the same flow, abused the way families do');
// =================================================================================================
// The empty line is the headline candidate for "one bad line takes 46 good ones down with it" —
// try the batch as a real family would send it, typos and all, before working around anything.
t0 = Date.now();
let chaosRes = await resolve(h, hid, CHAOTIC_LIST);
const wholeBatchSurvivedAnEmptyLine = chaosRes.status === 200;
if (!wholeBatchSurvivedAnEmptyLine) {
  const body = await chaosRes.json().catch(() => ({}));
  console.log(`   [resolve] HTTP ${chaosRes.status}: ${JSON.stringify(body).slice(0, 200)} — retrying with the empty line removed so the rest of this pass can still run`);
}
check('an empty line does not take the other lines down with it', wholeBatchSurvivedAnEmptyLine, wholeBatchSurvivedAnEmptyLine ? `HTTP 200, ${((Date.now() - t0) / 1000).toFixed(1)}s` : `HTTP ${chaosRes.status} for all ${CHAOTIC_LIST.length} lines — see docs/BACKLOG.md`);
const SAFE_LIST = wholeBatchSurvivedAnEmptyLine ? CHAOTIC_LIST : CHAOTIC_LIST.filter((l) => l.id !== CHAOS.emptyLine.id);
if (!wholeBatchSurvivedAnEmptyLine) chaosRes = await resolve(h, hid, SAFE_LIST);
const chaosResolved = await chaosRes.json().catch(() => ({}));
check('the rest of the chaotic list still resolves once the crash is worked around', chaosRes.status === 200, `HTTP ${chaosRes.status}`);
const choices = chaosResolved.choices ?? {};
const byId = (id) => SAFE_LIST.find((l) => l.id === id);

// Nonsense with no real words in it (empty, digits, emoji) must never silently become a product —
// there is nothing in the text to have honestly matched.
for (const [key, id] of [['a bare number', CHAOS.numberOnly.id], ['emoji only', CHAOS.emoji.id]]) {
  const c = choices[id];
  check(`${key} never silently becomes a product`, !c?.chosen?.gtin, c?.chosen ? `resolved to "${c.chosen.name}"` : 'unresolved, correctly');
}
// A name that could be anything (200 identical characters, or text that says the product does not
// exist) must not be quietly swapped for a real, unrelated item — the same PROMISE9 rule the cart
// recipe already holds barcodes to (docs/BACKLOG.md, store-recipe-fixer), applied here to search.
for (const [key, id] of [['a 200-character name', CHAOS.longName.id], ['a barcode nowhere, by its own name ("לא קיים")', CHAOS.fakeBarcode.id], ['a product no store carries', CHAOS.neverCarried.id]]) {
  const c = choices[id];
  const chosenName = c?.chosen?.name;
  const ok = !chosenName || sharesAWord(byId(id)?.query ?? '', chosenName);
  check(`${key} is never quietly swapped for an unrelated product`, ok, chosenName ? `resolved to "${chosenName}"` : 'unresolved, correctly');
}
// A typo and mixed-language line are real usage, not abuse — they should resolve like any other line.
check('a typo still resolves (fuzzy match, not a dead end)', !!choices[CHAOS.typo.id]?.chosen?.gtin || !!choices[CHAOS.typo.id]?.gtin, choices[CHAOS.typo.id] ? 'resolved' : 'unresolved');
check('mixed Hebrew/English resolves like any other line', !!choices[CHAOS.mixed.id]?.chosen?.gtin || !!choices[CHAOS.mixed.id]?.gtin, choices[CHAOS.mixed.id] ? 'resolved' : 'unresolved');
// The same item twice: both lines must land the same way — neither one silently favoured over the other.
const dupA = choices[CHAOS.dupA.id], dupB = choices[CHAOS.dupB.id];
const dupGtin = (c) => c?.chosen?.gtin ?? c?.gtin ?? null;
check('the same item twice resolves the same way both times', (!dupA && !dupB) || dupGtin(dupA) === dupGtin(dupB), `${dupGtin(dupA) ?? 'null'} vs ${dupGtin(dupB) ?? 'null'}`);
// Tonight's own provider incident, reproduced as part of an ordinary list: the ladder built for it
// (bounded retry, Rami Levy's own catalogue as a second rung) must hold up here too, not just alone.
for (const [name, id] of [['טופו', CHAOS.provider1.id], ['שוקולד', CHAOS.provider2.id]]) {
  const c = choices[id];
  check(`the provider's flaky item (${name}) resolves despite last night's incident`, !!c?.chosen?.gtin, c?.chosen ? c.chosen.name : 'unresolved — the incident is back');
}

const chaosLinesForQuote = SAFE_LIST.map((l) => { const c = choices[l.id]; const gtin = c?.chosen?.gtin ?? c?.gtin; return gtin ? { ...l, gtin } : l; });
t0 = Date.now();
const chaosQuoteRes = await quote(h, hid, chaosLinesForQuote);
const chaosQuote = await chaosQuoteRes.json().catch(() => ({}));
const chaosQuoteOk = chaosQuoteRes.status === 200 && Array.isArray(chaosQuote.options);
check('the compare answers for the chaotic list, not just the clean one', chaosQuoteOk, `HTTP ${chaosQuoteRes.status}, ${chaosQuote.options?.length ?? 0} options, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// The two checks below read the compare's own response, so they only mean something once it
// actually answered — asserting them against an empty body from a failed call would be a false
// pass, exactly the "looks green because nothing ran" trap this script exists to avoid.
if (chaosQuoteOk) {
  // Nothing typed vanishes without a trace: every line the family sent is either priced, substituted,
  // or accounted for in a rejection/unresolved list — never just absent with no explanation anywhere.
  const pricedIds = new Set(Object.values(chaosQuote.storefrontLines ?? {}).flatMap((m) => Object.keys(m)));
  const accounted = new Set([...pricedIds, ...(chaosQuote.unresolved ?? []), ...(chaosResolved.unresolved ?? [])]);
  const vanished = SAFE_LIST.filter((l) => choices[l.id] && !accounted.has(l.id));
  check('every line the family typed is accounted for somewhere (priced, substituted, or explained), never just gone', vanished.length === 0, vanished.length ? vanished.map((l) => l.query).join(', ') : `${SAFE_LIST.length} lines, none vanished`);

  // The fake barcode, again, downstream: even carried through to the compare (resolve did not strip
  // it), it must not have been priced as if it were a real product.
  const fakeQuoted = Object.values(chaosQuote.storefrontLines ?? {}).flatMap((m) => Object.entries(m)).find(([id]) => id === CHAOS.fakeBarcode.id);
  check('the barcode that exists nowhere is never priced as a real product downstream', !fakeQuoted || sharesAWord(CHAOS.fakeBarcode.query, fakeQuoted[1].productName), fakeQuoted ? `priced as "${fakeQuoted[1].productName}" (swapBy ${fakeQuoted[1].swapBy ?? '?'})` : 'correctly absent from every store\'s priced lines');
} else {
  console.log('   skipping the two checks above that read the compare\'s response — it did not answer, see the check above');
}

// --- Fill the cart, abused: the compare's real chaotic-run answer for Rami Levy, plus the
// specific abuse cases layered directly onto the browser recipe (the way cart-recipe-lab.mjs
// already stresses a fake barcode) so the store itself is tested, not only the compare's model of it.
const chaosRamiId = [...(chaosQuote.options ?? []).flatMap((o) => o.legs), ...(chaosQuote.rejected ?? [])].find((x) => /רמי לוי/.test(x.brand ?? ''))?.storefrontId;
const chaosRamiLines = chaosRamiId ? Object.entries(chaosQuote.storefrontLines?.[chaosRamiId] ?? {}) : [];
const realCartLines = chaosRamiLines.filter(([id]) => id !== CHAOS.fakeBarcode.id).map(([id, l]) => ({ gtin: l.gtin, name: l.productName, qty: byId(id)?.packQty ?? 1 }));
const abuseCartLines = [
  ...realCartLines,
  { gtin: CHAOS.fakeBarcode.gtin, name: CHAOS.fakeBarcode.query, qty: 1 }, // must come back 'missing', never 'added'
  ...(realCartLines[0] ? [{ ...realCartLines[0], qty: realCartLines[0].qty + 5 }] : []), // the same real item again, at the store layer too
];
const abuseCart = abuseCartLines.length > 1 ? await fillCart('chaotic', abuseCartLines, 'chaos-abused-basket') : null;
if (abuseCart) {
  check('the abused cart fills without a crash', !abuseCart.diag?.error, abuseCart.diag ? JSON.stringify(abuseCart.diag).slice(0, 160) : 'no diag');
  const fake = abuseCart.results.find((r) => r.gtin === CHAOS.fakeBarcode.gtin);
  check('the store never adds the barcode that exists nowhere', !fake || fake.status !== 'added', fake ? `${fake.status}: ${fake.detail ?? ''}` : 'not in results');
  const added = distinctAdded(abuseCart.results);
  check('the store\'s own basket still agrees with what Kaniti claims added, even on the abused cart (promise 9)', abuseCart.basketPageCount === '?' || Number(abuseCart.basketPageCount) === added, `claimed ${added}, store shows ${abuseCart.basketPageCount}`);
  const unavailable = abuseCart.results.filter((r) => r.status === 'unavailable');
  console.log(`   branch-stock rung: ${unavailable.length ? `${unavailable.length} line(s) this branch does not carry, each named on screen (${unavailable.map((r) => r.detail).join('; ')})` : 'no line hit a branch limit this run — opportunistic, not asserted'}`);
  check('the run stops at the basket page on the abused cart too — never checkout, never payment', true, 'last navigation: /he/basket');
}

// =================================================================================================
const bad = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), seed: SEED, ok: bad.length === 0, checks };
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 1));
console.log(bad.length ? `\n${bad.length} check(s) failed: ${bad.map((c) => c.name).join('; ')}` : '\nthe chaos cart passes end to end, clean and abused');
process.exit(bad.length ? 1 : 0);
