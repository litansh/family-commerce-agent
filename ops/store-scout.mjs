/**
 * The store scout: which storefronts serve our families today, and which are new.
 *
 * For every household address, ask the pricing provider who delivers there; keep the
 * union in ~/.kaniti/health/storefronts.json; report anything not seen before, and
 * anything Kaniti cannot connect on the phone yet (no store recipe matches its slug).
 * Stage 0 (observe): it changes nothing in the product. A new storefront on a known
 * platform is a one-line addition to apps/mobile/src/lib/stores.ts — the report says so
 * and names the platform; the store-recipe-fixer agent can then open the PR.
 *
 *   node ops/store-scout.mjs            (AWS_PROFILE=personal-cfo for the addresses; falls back to the two known ones)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { McpClient } from '../services/retailer-connectors/src/mcp-client.ts';
import { STORES } from '../apps/mobile/src/lib/stores.ts';

const FILE = `${homedir()}/.kaniti/health/storefronts.json`;
mkdirSync(`${homedir()}/.kaniti/health`, { recursive: true });
let known = {};
try { known = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* first run */ }

// Addresses: every household with one, or the two we always have.
let addresses = [];
try {
  const out = execFileSync('aws', ['dynamodb', 'scan', '--table-name', 'fca-main', '--region', 'eu-central-1', '--filter-expression', 'SK = :s', '--expression-attribute-values', JSON.stringify({ ':s': { S: 'META' } }), '--projection-expression', 'address', '--output', 'json'], { env: { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'personal-cfo' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).toString();
  addresses = [...new Set((JSON.parse(out).Items ?? []).map((i) => i.address?.S).filter((a) => a && a.length > 5))];
} catch { addresses = []; }
if (!addresses.length) addresses = ['ביאליק 20, רמת גן', 'רופין 10, כפר סבא'];

const c = new McpClient('https://supermcp.web.app/mcp');
const seen = {};
for (const address of addresses) {
  const opts = await c.callTool('list_delivery_options', { address }).catch(() => ({ options: [] }));
  for (const o of opts.options ?? []) {
    if (!o.coverage?.serves) continue;
    const row = seen[o.serviceSlug] ?? (seen[o.serviceSlug] = { slug: o.serviceSlug, brand: o.brand, chain: o.chainName, chainId: o.chainId, type: o.serviceType, catalogue: o.catalogSize ?? 0, addresses: [] });
    row.addresses.push(address);
  }
}

// Which of these can Kaniti connect on the phone? A store recipe matches the slug.
const connectable = (slug) => Object.values(STORES).some((s) => s.storefront.test(slug));
const fresh = Object.values(seen).filter((r) => !known[r.slug]);
const notConnectable = Object.values(seen).filter((r) => !connectable(r.slug));
const platformOf = (r) => (/^wolt-/.test(r.slug) ? 'wolt' : ['7290696200003', '7290055700007', '7290785400000', '7290661400001', '7290873255550'].includes(r.chainId) ? 'stor.ai' : r.chainId === '7290058140886' ? 'rami-levy' : r.chainId === '7290027600007' ? 'shufersal' : r.chainId === '7290700100008' ? 'hazi-hinam' : 'unknown');

const lines = [
  `🛒 store scout · ${new Date().toISOString().slice(0, 10)} · ${addresses.length} address(es) · ${Object.keys(seen).length} storefronts deliver`,
  fresh.length ? `new since last look: ${fresh.map((r) => `${r.brand} (${r.slug}, ${r.catalogue} items)`).join('; ')}` : 'no new storefronts',
  notConnectable.length ? `not connectable on the phone yet: ${notConnectable.map((r) => `${r.slug} → platform ${platformOf(r)}`).join('; ')}` : 'every storefront that delivers can be connected on the phone',
];
const text = lines.join('\n');
console.log(text);
for (const r of Object.values(seen)) known[r.slug] = { ...r, firstSeen: known[r.slug]?.firstSeen ?? new Date().toISOString(), lastSeen: new Date().toISOString() };
writeFileSync(FILE, JSON.stringify(known, null, 1));

let tg = {};
try { tg = Object.fromEntries(readFileSync(`${homedir()}/.kaniti/telegram.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((x) => x.trim()))); } catch { /* not configured */ }
if (tg.TELEGRAM_BOT_TOKEN && tg.TELEGRAM_CHAT_ID && (fresh.length || notConnectable.length)) {
  await fetch(`https://api.telegram.org/bot${tg.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: tg.TELEGRAM_CHAT_ID, text }) }).catch(() => null);
}
