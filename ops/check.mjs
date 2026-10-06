/**
 * The orchestrator's eyes: every check Kaniti has, run from this Mac (a residential
 * network, like a phone), summarised in one table and one JSON report. Also derives, from
 * that same run, whether each ADR 0010 ladder (connect, compare, fill the cart, read
 * history, prices in-store) has at least two working rungs today — one rung left (or a
 * ladder no daily lab touches at all) is a red check, same as any other.
 *
 *   node ops/check.mjs [--sim] [--only stores,cart,prices,api,search,deals,shopper,topup,chaos,unit,recipes]
 *
 * Exit 1 when anything is unhealthy. The report goes to ~/.kaniti/health/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const withSim = args.includes('--sim');

// Detached labs no longer share our terminal's Ctrl-C: take them down with us.
const children = new Set();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const pid of children) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } } process.exit(130); });
const run = (name, cmd, cwd, timeoutMs, judge) => new Promise((done) => {
  const t0 = Date.now();
  // Its own process group, so the timeout kills the lab itself and not only the `bash -lc` around it:
  // killing bash alone left node and its browser holding the pipe, so a 600 s budget ended at 997 s
  // and the lab's late rows never reached the report (stores and chaos, 2026-10-06).
  const p = spawn('bash', ['-lc', cmd], { cwd, env: { ...process.env, CI: '' }, detached: true });
  let out = '';
  children.add(p.pid);
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); } out += '\n[timeout]'; }, timeoutMs);
  // A check that could not run to a verdict (timeout, no network) is 'unknown', not a failure: the two are opposite instructions.
  p.on('close', (code) => { clearTimeout(timer); children.delete(p.pid); const j = judge(out, code); const unknown = /\[timeout\]/.test(out) || /ENOTFOUND|ECONNREFUSED|fetch failed/.test(out) && !j.ok; done({ name, ok: j.ok, unknown, summary: unknown ? `unknown — ${j.summary}` : j.summary, code, seconds: Math.round((Date.now() - t0) / 1000), tail: out.split('\n').filter(Boolean).slice(-25).join('\n') }); });
});
const strip = (s) => s.replace(/\(node:\d+\) .*\n|\(Use `node --trace-warnings.*\n|Reparsing as ES module.*\n|To eliminate this warning.*\n/g, '');

const CHECKS = {
  recipes: () => run('recipes', 'node --experimental-strip-types e2e/recipe-syntax.mjs', `${ROOT}/apps/mobile`, 60_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').pop() })),
  unit: () => run('unit', 'npm test 2>&1 | grep -E "^# (pass|fail)"', ROOT, 300_000, (o) => { const pass = /# pass (\d+)/.exec(o)?.[1] ?? '?'; const fail = /# fail (\d+)/.exec(o)?.[1] ?? '?'; return { ok: fail === '0', summary: `pass ${pass} fail ${fail}` }; }),
  stores: () => run('stores', `node --experimental-strip-types e2e/store-health.mjs --json ${homedir()}/.kaniti/health/stores.json`, `${ROOT}/apps/mobile`, 600_000, (o, c) => ({ ok: c === 0, summary: (o.match(/all stores healthy|\d+ unhealthy: .*/)?.[0] ?? 'no verdict') })),
  // Promise 9: the lab's own claim ("added") must match the store's own state (its basket count, the real product behind a barcode); a PROMISE9-VIOLATION line from the lab is a red check regardless of how many lines were "added".
  // Also runs the per-item rung's own count lab (docs/BACKLOG.md): a store's basketCountJs must
  // still tell the truth on its search/product pages, not only on the cart page cart-recipe-lab.mjs drives.
  cart: () => run('cart', "node --experimental-strip-types e2e/cart-recipe-lab.mjs rami-levy; echo ---PER-ITEM---; node --experimental-strip-types e2e/per-item-count.mjs", `${ROOT}/apps/mobile`, 300_000, (o) => {
    const added = Number(/"added":(\d+)/.exec(o)?.[1] ?? 0);
    const badge = /basket page count: (\d+)/.exec(o)?.[1];
    const violations = [...o.matchAll(/PROMISE9-VIOLATION: (.+)/g)].map((m) => m[1]);
    const perItem = /^(ok|BAD)\s+the store's own count reads on its item pages — (\d+\/\d+)/m.exec(o);
    const perItemOk = perItem ? perItem[1] === 'ok' : false;
    const perItemSummary = perItem ? `per-item count ${perItem[2]}` : 'per-item count: no verdict';
    return { ok: added >= 2 && Number(badge) >= 2 && violations.length === 0 && perItemOk, summary: `${violations.length ? `rami-levy guest cart: ${violations.join('; ')}` : `rami-levy guest cart: ${added} added, basket shows ${badge ?? '?'}`}; ${perItemSummary}` };
  }),
  // ADR 0011's "read on the device": every store's historyJs, against the live login page,
  // logged out — it must still post without dying (mechanical), and turn a mocked-network order
  // shaped the way that store's own API ships it into {at,lines:[{name,code,qty}]} (field mapping).
  history: () => run('history', 'node --experimental-strip-types e2e/history-lab.mjs', `${ROOT}/apps/mobile`, 240_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').filter(Boolean).slice(-2).join(' · ') })),
  prices: () => run('prices', 'node --experimental-strip-types services/branch-prices/lab.mjs', ROOT, 900_000, (o) => { const priced = (o.match(/basket ₪/g) ?? []).length; const failed = (o.match(/FAILED/g) ?? []).length; return { ok: priced >= 3 && failed === 0, summary: `${priced} branches priced, ${failed} portal failures` }; }),
  api: () => run('api', 'node ops/api-health.mjs', ROOT, 120_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').pop() })),
  // Everyday Hebrew groceries through the catalogue search, not the provider's own vocabulary
  // (ADR 0010, Compare's second rung): red when any one of them cannot be found.
  search: () => run('search', 'node ops/search-health.mjs', ROOT, 120_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').filter(Boolean).pop() })),
  // "איך לקנות" is the screen the whole product is for, and every number on it must be one the family
  // could recompute from the same response, with nothing standing beside a number it is not comparable
  // with (docs/design/compare-accuracy.md; promises 2, 3, 4). Red when a store that is shut reads as one
  // that delivers, when the answer names no saving, when a partial basket stands beside a full one
  // without its completed total, or when a row speaks for its first leg instead of its whole option.
  compare: () => run('compare', 'node --experimental-strip-types e2e/compare-accuracy.mjs', `${ROOT}/apps/mobile`, 300_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').filter(Boolean).pop() })),
  // Promise 1: מבצעים is every store's window, not one chain's; a placeholder icon on most cards
  // is the commonest "the app looks unfinished" (both from tonight's report).
  deals: () => run('deals', 'node ops/deals-health.mjs', ROOT, 60_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').filter(Boolean).slice(0, 2).join(' · ') })),
  // The shopper agent: a five-person family's week (about 35 lines) through resolve → compare → cart lines; cheap, fast, split, substitutes, in-store.
  shopper: () => run('shopper', `node ops/test-cart.mjs --json ${homedir()}/.kaniti/health/test-cart.json`, ROOT, 300_000, (o, c) => ({ ok: c === 0, summary: (o.match(/the test cart passes end to end|\d+ check\(s\) failed: .*/)?.[0] ?? 'no verdict') })),
  topup: () => run('topup', `node ops/test-cart.mjs --short --json ${homedir()}/.kaniti/health/test-cart-short.json`, ROOT, 300_000, (o, c) => ({ ok: c === 0, summary: (o.match(/the top-up cart passes end to end|\d+ check\(s\) failed: .*/)?.[0] ?? 'no verdict') })),
  // The owner's own brief: a real family's cart goes the whole way, clean, then again with a dozen
  // abuse cases mixed in (typos, a barcode nowhere, an empty line, quantity 90...) through the
  // browser, not just the API — never a crash, never a silent drop, never a wrong product.
  chaos: () => run('chaos', `node --experimental-strip-types ops/chaos.mjs --json ${homedir()}/.kaniti/health/chaos.json`, ROOT, 600_000, (o, c) => ({ ok: c === 0, summary: (o.match(/the chaos cart passes end to end.*|\d+ check\(s\) failed: .*/)?.[0] ?? 'no verdict') })),
  sim: () => run('sim', './maestro/connect-all.sh && ./maestro/run.sh order', `${ROOT}/apps/mobile`, 2_400_000, (o) => { const rows = [...o.matchAll(/^([a-z-]+)\s+(yes|NO)\s+(yes|NO)/gm)]; const bad = rows.filter((r) => r[2] !== 'yes' || r[3] !== 'yes').map((r) => r[1]); const order = /Flow order[\s\S]*?(\d+)\/(\d+)/.exec(o); return { ok: rows.length === 9 && bad.length === 0, summary: `connect ${rows.length - bad.length}/${rows.length}${bad.length ? ` (bad: ${bad.join(',')})` : ''}${order ? `, order ${order[1]}/${order[2]}` : ''}` }; }),
};

// ADR 0010: no store action depends on one flow. A ladder is healthy only when at least two of
// its rungs are proven — not assumed — by today's labs; one rung left is a red check.
// This reads the same run's own results, so it costs nothing extra: no lab runs twice.
function ladderHealth(results) {
  const by = Object.fromEntries(results.map((r) => [r.name, r]));
  const has = (n) => by[n] !== undefined;
  const ladders = [];
  if (has('stores')) {
    // The earlier connect rungs (session capture, OTP, password, cloud restore) need a real
    // household and are not exercised by any daily lab (docs/BACKLOG.md, "Connect and stay connected").
    ladders.push({ ladder: 'Connect', rungs: [{ name: 'the store\'s own login page (stores)', ok: by.stores.ok }] });
  }
  if (has('api') || has('shopper') || has('topup') || has('prices')) {
    const subsOk = [by.shopper, by.topup].some((r) => r && /^ok\s+substitutes are the same kind of product/m.test(r.tail));
    const rungs = [];
    if (has('api')) rungs.push({ name: 'SuperMCP quote (api)', ok: by.api.ok });
    if (has('search')) rungs.push({ name: "the chains' own catalogues (search)", ok: by.search.ok });
    if (has('shopper') || has('topup')) rungs.push({ name: 'substitutes from the catalogue', ok: subsOk });
    if (has('prices')) rungs.push({ name: 'price-transparency files (prices)', ok: by.prices.ok });
    ladders.push({ ladder: 'Compare', rungs });
  }
  if (has('cart')) ladders.push({ ladder: 'Fill the cart', rungs: [{ name: 'rami-levy guest cart (cart)', ok: by.cart.ok }] });
  if (has('history')) {
    const rung = (label) => { const m = new RegExp(`${label}: (\\d+)/(\\d+) stores`).exec(by.history.tail); return m ? m[1] === m[2] : false; };
    ladders.push({ ladder: 'Read history', rungs: [{ name: 'every store posts, logged out (history)', ok: rung('mechanical') }, { name: "field mapping matches the store's own shape (history)", ok: rung('field mapping') }] });
  }
  if (has('prices')) ladders.push({ ladder: 'Prices in-store', rungs: [{ name: 'six chains\' portals (prices)', ok: by.prices.ok }] });
  return ladders.map((l) => { const working = l.rungs.filter((r) => r.ok).length; return { ...l, working, of: l.rungs.length, ok: working >= 2 }; });
}

mkdirSync(`${homedir()}/.kaniti/health`, { recursive: true });
const names = (only ?? ['recipes', 'unit', 'stores', 'cart', 'history', 'prices', 'api', 'search', 'deals', 'shopper', 'topup', 'chaos']).filter((n) => CHECKS[n]);
if (withSim && !only) names.push('sim');
// Browser checks share the network but not the simulator: everything but `sim` runs in parallel,
// except the checks that drive the production API, which run one after another. The account's
// Lambda concurrency is 10 (ops/NEEDS-HUMAN.md); six of them at once (three week-long compares,
// eight parallel searches) had API Gateway throttle fca-api, and the checks then reported the
// gateway's own 0.3 s "Service Unavailable" as search, quote and chaos failures (2026-10-03..05).
// One family never makes that burst; the capacity question stays in NEEDS-HUMAN, not in the checks.
const API_CHECKS = ['api', 'search', 'deals', 'shopper', 'topup', 'chaos', 'compare'];
const parallel = names.filter((n) => n !== 'sim' && !API_CHECKS.includes(n));
const serial = names.filter((n) => API_CHECKS.includes(n));
const runSerial = async () => { const out = []; for (const n of serial) out.push(await CHECKS[n]()); return out; };
const [side, apiResults] = await Promise.all([Promise.all(parallel.map((n) => CHECKS[n]())), runSerial()]);
// Keep the report in the order the checks were named.
const byName = Object.fromEntries([...side, ...apiResults].map((r) => [r.name, r]));
const results = names.filter((n) => n !== 'sim').map((n) => byName[n]);
if (names.includes('sim')) results.push(await CHECKS.sim());

const at = new Date().toISOString();
console.log(`\nKaniti health · ${at}`);
console.log('check     ok   time   summary');
for (const r of results) console.log(`${r.name.padEnd(9)} ${(r.ok ? 'ok' : r.unknown ? '?' : 'BAD').padEnd(4)} ${String(r.seconds + 's').padEnd(6)} ${r.summary}`);
const ladders = ladderHealth(results);
if (ladders.length) {
  console.log('\nladders (ADR 0010) — at least two working rungs, checked daily');
  for (const l of ladders) console.log(`${(l.ok ? 'ok  ' : 'BAD ')} ${l.ladder.padEnd(16)} ${l.working}/${l.of} rung(s) working${l.of ? ` (${l.rungs.map((r) => `${r.ok ? 'ok' : 'BAD'} ${r.name}`).join(', ')})` : ' — no daily lab exercises this ladder at all'}`);
}
const report = { at, ok: results.every((r) => r.ok) && ladders.every((l) => l.ok), results, ladders };
const stamp = at.replace(/[:.]/g, '-');
writeFileSync(`${homedir()}/.kaniti/health/${stamp}.json`, JSON.stringify(report, null, 1));
writeFileSync(`${homedir()}/.kaniti/health/latest.json`, JSON.stringify(report, null, 1));
console.log(report.ok ? '\nall healthy' : `\nUNHEALTHY: ${results.filter((r) => !r.ok).map((r) => r.name).concat(ladders.filter((l) => !l.ok).map((l) => `ladder:${l.ladder}`)).join(', ')}  (report: ~/.kaniti/health/latest.json)`);
process.exit(report.ok ? 0 : 1);
