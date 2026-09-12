/**
 * The orchestrator's eyes: every check Kaniti has, run from this Mac (a residential
 * network, like a phone), summarised in one table and one JSON report.
 *
 *   node ops/check.mjs [--sim] [--only stores,cart,prices,api,unit,recipes]
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

const run = (name, cmd, cwd, timeoutMs, judge) => new Promise((done) => {
  const t0 = Date.now();
  const p = spawn('bash', ['-lc', cmd], { cwd, env: { ...process.env, CI: '' } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { p.kill('SIGKILL'); out += '\n[timeout]'; }, timeoutMs);
  // A check that could not run to a verdict (timeout, no network) is 'unknown', not a failure: the two are opposite instructions.
  p.on('close', (code) => { clearTimeout(timer); const j = judge(out, code); const unknown = /\[timeout\]/.test(out) || /ENOTFOUND|ECONNREFUSED|fetch failed/.test(out) && !j.ok; done({ name, ok: j.ok, unknown, summary: unknown ? `unknown — ${j.summary}` : j.summary, code, seconds: Math.round((Date.now() - t0) / 1000), tail: out.split('\n').filter(Boolean).slice(-25).join('\n') }); });
});
const strip = (s) => s.replace(/\(node:\d+\) .*\n|\(Use `node --trace-warnings.*\n|Reparsing as ES module.*\n|To eliminate this warning.*\n/g, '');

const CHECKS = {
  recipes: () => run('recipes', 'node --experimental-strip-types e2e/recipe-syntax.mjs', `${ROOT}/apps/mobile`, 60_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').pop() })),
  unit: () => run('unit', 'npm test 2>&1 | grep -E "^# (pass|fail)"', ROOT, 300_000, (o) => { const pass = /# pass (\d+)/.exec(o)?.[1] ?? '?'; const fail = /# fail (\d+)/.exec(o)?.[1] ?? '?'; return { ok: fail === '0', summary: `pass ${pass} fail ${fail}` }; }),
  stores: () => run('stores', `node --experimental-strip-types e2e/store-health.mjs --json ${homedir()}/.kaniti/health/stores.json`, `${ROOT}/apps/mobile`, 600_000, (o, c) => ({ ok: c === 0, summary: (o.match(/all stores healthy|\d+ unhealthy: .*/)?.[0] ?? 'no verdict') })),
  // Promise 9: the lab's own claim ("added") must match the store's own state (its basket count, the real product behind a barcode); a PROMISE9-VIOLATION line from the lab is a red check regardless of how many lines were "added".
  cart: () => run('cart', 'node --experimental-strip-types e2e/cart-recipe-lab.mjs rami-levy', `${ROOT}/apps/mobile`, 240_000, (o) => { const added = Number(/"added":(\d+)/.exec(o)?.[1] ?? 0); const badge = /basket page count: (\d+)/.exec(o)?.[1]; const violations = [...o.matchAll(/PROMISE9-VIOLATION: (.+)/g)].map((m) => m[1]); return { ok: added >= 2 && Number(badge) >= 2 && violations.length === 0, summary: violations.length ? `rami-levy guest cart: ${violations.join('; ')}` : `rami-levy guest cart: ${added} added, basket shows ${badge ?? '?'}` }; }),
  prices: () => run('prices', 'node --experimental-strip-types services/branch-prices/lab.mjs', ROOT, 900_000, (o) => { const priced = (o.match(/basket ₪/g) ?? []).length; const failed = (o.match(/FAILED/g) ?? []).length; return { ok: priced >= 3 && failed === 0, summary: `${priced} branches priced, ${failed} portal failures` }; }),
  api: () => run('api', 'node ops/api-health.mjs', ROOT, 120_000, (o, c) => ({ ok: c === 0, summary: strip(o).trim().split('\n').pop() })),
  // The shopper agent: a five-person family's week (about 35 lines) through resolve → compare → cart lines; cheap, fast, split, substitutes, in-store.
  shopper: () => run('shopper', `node ops/test-cart.mjs --json ${homedir()}/.kaniti/health/test-cart.json`, ROOT, 300_000, (o, c) => ({ ok: c === 0, summary: (o.match(/the test cart passes end to end|\d+ check\(s\) failed: .*/)?.[0] ?? 'no verdict') })),
  topup: () => run('topup', `node ops/test-cart.mjs --short --json ${homedir()}/.kaniti/health/test-cart-short.json`, ROOT, 300_000, (o, c) => ({ ok: c === 0, summary: (o.match(/the top-up cart passes end to end|\d+ check\(s\) failed: .*/)?.[0] ?? 'no verdict') })),
  sim: () => run('sim', './maestro/connect-all.sh && ./maestro/run.sh order', `${ROOT}/apps/mobile`, 2_400_000, (o) => { const rows = [...o.matchAll(/^([a-z-]+)\s+(yes|NO)\s+(yes|NO)/gm)]; const bad = rows.filter((r) => r[2] !== 'yes' || r[3] !== 'yes').map((r) => r[1]); const order = /Flow order[\s\S]*?(\d+)\/(\d+)/.exec(o); return { ok: rows.length === 9 && bad.length === 0, summary: `connect ${rows.length - bad.length}/${rows.length}${bad.length ? ` (bad: ${bad.join(',')})` : ''}${order ? `, order ${order[1]}/${order[2]}` : ''}` }; }),
};

mkdirSync(`${homedir()}/.kaniti/health`, { recursive: true });
const names = (only ?? ['recipes', 'unit', 'stores', 'cart', 'prices', 'api', 'shopper', 'topup']).filter((n) => CHECKS[n]);
if (withSim && !only) names.push('sim');
// Browser checks share the network but not the simulator: everything but `sim` runs in parallel.
const parallel = names.filter((n) => n !== 'sim');
const results = await Promise.all(parallel.map((n) => CHECKS[n]()));
if (names.includes('sim')) results.push(await CHECKS.sim());

const at = new Date().toISOString();
console.log(`\nKaniti health · ${at}`);
console.log('check     ok   time   summary');
for (const r of results) console.log(`${r.name.padEnd(9)} ${(r.ok ? 'ok' : r.unknown ? '?' : 'BAD').padEnd(4)} ${String(r.seconds + 's').padEnd(6)} ${r.summary}`);
const report = { at, ok: results.every((r) => r.ok), results };
const stamp = at.replace(/[:.]/g, '-');
writeFileSync(`${homedir()}/.kaniti/health/${stamp}.json`, JSON.stringify(report, null, 1));
writeFileSync(`${homedir()}/.kaniti/health/latest.json`, JSON.stringify(report, null, 1));
console.log(report.ok ? '\nall healthy' : `\nUNHEALTHY: ${results.filter((r) => !r.ok).map((r) => r.name).join(', ')}  (report: ~/.kaniti/health/latest.json)`);
process.exit(report.ok ? 0 : 1);
