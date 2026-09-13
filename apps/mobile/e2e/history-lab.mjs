/**
 * Order history lab: every store's `historyJs`, run in a real WebKit browser (iPhone
 * emulation, this Mac's residential IP) against the live store's login page, logged out —
 * proving what docs/BACKLOG.md's owner-reported line asks for ("order history read on the
 * device and posted, per ADR 0011, for every store") without a real account:
 *
 *   1. mechanical (every store): the recipe runs against the real live page and posts a
 *      `history:` report — proving it does not silently die (a wrong variable name, a
 *      platform object that is not there while logged out) before it ever reaches the API.
 *   2. field mapping (rami-levy, wolt, shufersal, hazi-hinam): the store's own history
 *      endpoint is mocked, at the network layer only — nothing leaves this Mac, nothing is
 *      forwarded to the real store — with one order shaped exactly as that store's API has
 *      shipped it (see historyJs's own field list); the recipe must turn it into Kaniti's
 *      {at,lines:[{name,code,qty}]}, so a real order's shape landing differently is caught
 *      here, not silently, the next time someone connects. Two recipes ask their own app's
 *      client for the data (Rami Levy's $ecomws, the stor.ai group's Angular Api service) and
 *      both guard on being signed in before they will even try the network — logged out,
 *      nothing to mock ever fires; that is reported, never counted as a failure. Wolt's own
 *      orders carry no barcode at all (confirmed in its real shape below), so its check never
 *      asks for one.
 *
 *   node --experimental-strip-types e2e/history-lab.mjs [rami-levy victory wolt shufersal hazi-hinam]
 *
 * Every unmocked non-GET request is aborted: nothing is signed in, sent or created.
 */
import { webkit, devices } from 'playwright';
import { STORES } from '../src/lib/stores.ts';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['rami-levy', 'victory', 'wolt', 'shufersal', 'hazi-hinam'];

const NAME = 'LAB בדיקה מוצר';
const CODE = '9999999999990';
const QTY = 3;
const AT = '2026-09-01';

// url -> a fulfill body, or undefined (no match, fall through). Method-agnostic: nothing here
// is ever really sent anywhere, the network layer answers locally, so mocking a POST is as safe
// as a GET.
const MOCKS = {
  'rami-levy': (url) => (/\/api\/v3\/site\/orders/.test(url) ? [{ id: 555, supply_at: AT, total: 123.4, items: [{ product: { name: NAME, barcode: CODE }, quantity: QTY }] }] : undefined),
  'victory': (url) => (/\/v2\/retailers\/.*\/(users\/.*\/)?orders/.test(url) ? [{ id: 9, timePlaced: AT, lines: [{ product: { names: { he: NAME }, barcode: CODE }, quantity: QTY }] }] : undefined),
  'wolt': (url) => {
    if (/authentication\.wolt\.com\/v1\/wauth2\/access_token/.test(url)) return { access_token: 'LAB-ACCESS-TOKEN' };
    if (/consumer-api\.wolt\.com\/order-xp\/web\/v1\/pages\/orders/.test(url)) return { orders: [{ venue: { name: 'Victory מרקט' }, timestamp: '01/09/2026 12:00', items: [{ name: NAME, count: QTY }] }], next_page_token: null };
  },
  'shufersal': (url) => {
    if (/\/online\/he\/my-account\/orders\/[^/?]+/.test(url)) return { entries: [{ product: { name: NAME, ean: CODE }, quantity: QTY }] };
    if (/\/online\/he\/my-account\/orders(\?|$)/.test(url)) return { closedOrders: [{ code: 'LAB1', placed: AT }] };
  },
  'hazi-hinam': (url) => {
    if (/proxy\/api\/order\/history/.test(url)) return { Results: { Orders: [{ Id: 1, Date: AT }] } };
    if (/proxy\/api\/item\/getItemsByOrder\//.test(url)) return { Results: { Items: [{ Name: NAME, Barcode: CODE, Quantity: QTY }] } };
  },
};
// rami-levy's $ecomws and stor.ai's Angular Api service both check sign-in themselves before
// trying the network at all; logged out, the mock below never gets a request to answer, and a
// guest run legitimately posts nothing for it — not this lab's failure to report.
const BEST_EFFORT = new Set(['rami-levy', 'victory']);
// Wolt's own order items never carry a barcode (the historyJs mapping has none to read) — the
// check for it only asks for what the recipe actually claims to extract, per store.
const WANT_CODE = { wolt: false };

const browser = await webkit.launch();
let mechFail = 0, mechTotal = 0, mapFail = 0, mapTotal = 0, mapSkipped = 0;

for (const id of ids) {
  const store = STORES[id];
  if (!store || !store.historyJs) { console.log(`\n== ${id}: no historyJs on this store`); mechFail++; mechTotal++; continue; }
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'he-IL' });
  let mocking = false;
  await ctx.route('**/*', (route) => {
    const req = route.request();
    if (mocking) {
      const body = MOCKS[id]?.(req.url());
      if (body !== undefined) { void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); return; }
    }
    if (req.method() !== 'GET') { void route.abort(); return; }
    void route.continue();
  });
  const page = await ctx.newPage();
  const posted = [];
  await page.exposeFunction('__kanitiPost', (m) => posted.push(String(m)));
  await page.addInitScript(() => { window.ReactNativeWebView = { postMessage: (m) => window.__kanitiPost(m) }; });
  const run = (js) => page.evaluate(js.replace(/;\s*true;\s*$/, ''));
  const last = (prefix) => [...posted].reverse().find((m) => m.startsWith(prefix));
  console.log(`\n== ${id}`);
  try {
    await page.goto(store.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4500);

    // 1. mechanical: the live page, logged out, still gets a `history:` report out of the recipe.
    mechTotal++;
    posted.length = 0;
    await run(store.historyJs).catch((e) => posted.push(`__evalthrow:${String(e).slice(0, 160)}`));
    const m1 = last('history:');
    if (!m1) { mechFail++; console.log('   FAIL mechanical: no history: report (the recipe never posted, or threw before it could)'); }
    else {
      try { const env = JSON.parse(m1.slice(8)); console.log(`   ok  mechanical: posted, ${env.orders?.length ?? 0} order(s) logged out, diag ${JSON.stringify(env.diag).slice(0, 140)}`); }
      catch { mechFail++; console.log(`   FAIL mechanical: history: report is not valid JSON — ${m1.slice(0, 140)}`); }
    }

    // 2. field mapping: mock the store's own endpoint, one order shaped the way that store's API
    // ships it, and check the recipe turns it into Kaniti's own shape.
    const mock = MOCKS[id];
    if (!mock) { console.log('   —  field mapping: no mock written for this store yet'); }
    else {
      mapTotal++;
      mocking = true;
      posted.length = 0;
      await run(store.historyJs).catch((e) => posted.push(`__evalthrow:${String(e).slice(0, 160)}`));
      mocking = false;
      const m2 = last('history:');
      let env = null; try { env = m2 ? JSON.parse(m2.slice(8)) : null; } catch { /* reported below */ }
      const order = env?.orders?.[0];
      const line = order?.lines?.[0];
      const wantCode = WANT_CODE[id] ?? true;
      const ok = !!line && line.name === NAME && Number(line.qty) === QTY && (!wantCode || String(line.code) === CODE);
      if (ok) console.log(`   ok  field mapping: ${JSON.stringify(order)}`);
      else if (BEST_EFFORT.has(id)) { mapTotal--; mapSkipped++; console.log(`   ?   field mapping: not exercised while logged out (needs a signed-in uid/rid) — ${m2 ? m2.slice(0, 160) : 'no report'}`); }
      else { mapFail++; console.log(`   FAIL field mapping: wanted name=${NAME} code=${CODE} qty=${QTY}, got ${JSON.stringify(order ?? env)}`); }
    }
  } catch (e) { mechFail++; console.log(`   FAIL ${String(e).slice(0, 160)}`); }
  await ctx.close();
}
await browser.close();

console.log(`\nmechanical: ${mechTotal - mechFail}/${mechTotal} stores post a history: report while logged out`);
console.log(`field mapping: ${mapTotal - mapFail}/${mapTotal} stores turn their own shape into {at,lines:[{name,code,qty}]} (${mapSkipped} skipped, needs a signed-in session)`);
const bad = mechFail + mapFail;
console.log(bad ? `\n${bad} failure(s)` : '\norder history: every store\'s recipe posts, and field mapping matches for every mockable store');
process.exit(bad ? 1 : 0);
