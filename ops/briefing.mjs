/**
 * The morning briefing: one message, every day, with the single next thing worth doing.
 *
 * Reads the product's own data (households, addresses, connected stores, compares,
 * carts, confirmed purchases) and the latest health report, walks the funnel, and
 * names the earliest broken stage. Sends to Telegram when configured; prints always.
 *
 *   node ops/briefing.mjs            (needs AWS_PROFILE=personal-cfo with a live session)
 *
 * Rules (from adtech-lab's orchestrator): a stage that could not be observed is
 * reported as such and the diagnosis stops there — never as zero. The message goes out
 * even when nothing changed, so a missing briefing means the bot is dead, not idle.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const REGION = 'eu-central-1';
const TABLE = 'fca-main';
const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'personal-cfo' };

function scan(filter, values, projection, names) {
  const args = ['dynamodb', 'scan', '--table-name', TABLE, '--region', REGION, '--filter-expression', filter, '--expression-attribute-values', JSON.stringify(values), '--projection-expression', projection, '--output', 'json', ...(names ? ['--expression-attribute-names', JSON.stringify(names)] : [])];
  const out = execFileSync('aws', args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).toString();
  return JSON.parse(out).Items ?? [];
}

const seen = {}; // stage → count, or -1 when it could not be observed
try {
  const metas = scan('SK = :s', { ':s': { S: 'META' } }, 'PK, address, addressDetails');
  seen.households = metas.length;
  seen.withAddress = metas.filter((m) => m.addressDetails?.M?.lat?.N).length;
  seen.connected = new Set(scan('begins_with(SK, :s)', { ':s': { S: 'SESSION#' } }, 'PK').map((r) => r.PK.S)).size;
  seen.branches = scan('SK = :s AND #st = :r', { ':s': { S: 'BRANCHES' }, ':r': { S: 'ready' } }, 'PK', { '#st': 'status' }).length;
  seen.purchases = new Set(scan('begins_with(SK, :s)', { ':s': { S: 'HISTORY#' } }, 'PK').map((r) => r.PK.S)).size;
} catch (e) {
  for (const k of ['households', 'withAddress', 'connected', 'branches', 'purchases']) if (seen[k] === undefined) seen[k] = -1;
  seen.error = String(e).split('\n')[0].slice(0, 120);
}

let health = null;
try { health = JSON.parse(readFileSync(`${homedir()}/.kaniti/health/latest.json`, 'utf8')); } catch { /* no run yet */ }

// The funnel, in order. The first stage that is broken (or unobservable) is the answer.
const stages = [
  ['households', seen.households, (n) => n > 0, 'no family has signed up yet — put the app in one more family\'s hands'],
  ['address', seen.withAddress, (n) => n > 0 && n >= seen.households * 0.8, 'families without an address set — the address step is where they stop'],
  ['connected', seen.connected, (n) => n > 0, 'no store is connected in the cloud — the connect flow is where they stop'],
  ['branches', seen.branches, (n) => n >= Math.max(1, seen.withAddress), 'in-store branches missing for some households — check the refresher log'],
  ['purchases', seen.purchases, (n) => n > 0, 'no confirmed purchase yet — order history is not being read; check import-history in the API log'],
];
let next = 'everything in the funnel has a pulse — spend the hour on the open items in docs/PRODUCT-REVIEW.md';
let blind = false;
for (const [name, n, ok, why] of stages) {
  if (n < 0) { next = `could not observe "${name}" (${seen.error ?? 'AWS session?'}) — log in and rerun; the funnel is blind from here`; blind = true; break; }
  if (!ok(n)) { next = `${name}: ${why}`; break; }
}
if (!blind && health && !health.ok) next = `health: ${health.results.filter((r) => !r.ok).map((r) => `${r.name} (${r.summary})`).join('; ')} — ops/repair.sh handles it; if it did not, that is the next hour`;

const day = new Date().toISOString().slice(0, 10);
const fmt = (n) => (n < 0 ? '?' : String(n));
const text = [
  `🛒 Kaniti briefing · ${day}`,
  `funnel: families ${fmt(seen.households)} · address ${fmt(seen.withAddress)} · store connected ${fmt(seen.connected)} · branches ready ${fmt(seen.branches)} · purchases read ${fmt(seen.purchases)}`,
  health ? `health (${health.at.slice(0, 16)}): ${health.ok ? 'all green' : health.results.filter((r) => !r.ok).map((r) => r.name).join(', ') + ' red'}` : 'health: no run yet',
  `next: ${next}`,
].join('\n');
console.log(text);

let tg = {};
try { tg = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/telegram.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((x) => x.trim()))); } catch { /* not configured */ }
if (tg.TELEGRAM_BOT_TOKEN && tg.TELEGRAM_CHAT_ID) {
  const r = await fetch(`https://api.telegram.org/bot${tg.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: tg.TELEGRAM_CHAT_ID, text }) }).catch(() => null);
  console.log(r?.ok ? '(sent to Telegram)' : '(Telegram send failed)');
}
