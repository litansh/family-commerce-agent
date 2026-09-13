/**
 * The only number that decides whether Kaniti is a product: did each family finish a shop this week.
 *
 *   node ops/families.mjs            (needs AWS_PROFILE=personal-cfo with a live session)
 *   node ops/families.mjs --weeks 4
 *
 * Not "did they open the app" and not "how many compares" — those go up while nothing changes in a
 * kitchen. A shop is finished when a purchase was confirmed from the store's own order history, which
 * is the one event nobody can fake by tapping around.
 *
 * This must be collected from the first family onwards: a week that passed unmeasured cannot be
 * measured later, and "five of ten in week three" is the sentence the whole plan turns on.
 */
import { execFileSync } from 'node:child_process';

const REGION = 'eu-central-1';
const TABLE = 'fca-main';
const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'personal-cfo' };
const weeks = Number(process.argv[process.argv.indexOf('--weeks') + 1]) || 4;

function scan(filter, values, projection) {
  const out = execFileSync('aws', [
    'dynamodb', 'scan', '--table-name', TABLE, '--region', REGION,
    '--filter-expression', filter, '--expression-attribute-values', JSON.stringify(values),
    '--projection-expression', projection, '--output', 'json',
  ], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).toString();
  return JSON.parse(out).Items ?? [];
}

const hid = (row) => String(row.PK?.S ?? '').replace(/^HOUSEHOLD#/, '');
const households = new Map();
for (const m of scan('SK = :s', { ':s': { S: 'META' } }, 'PK, #n, address, createdAt').map((x) => x)) {
  households.set(hid(m), { name: m.name?.S ?? m['#n']?.S ?? '(no name)', address: m.address?.S ?? '', createdAt: m.createdAt?.S ?? '' });
}

// Every confirmed purchase, by household and date, from the store's own history.
const shops = new Map();
for (const row of scan('begins_with(SK, :s)', { ':s': { S: 'HISTORY#' } }, 'PK, orders')) {
  const list = row.orders?.L ?? [];
  const dates = list.map((o) => o.M?.at?.S).filter(Boolean);
  const key = hid(row);
  shops.set(key, [...(shops.get(key) ?? []), ...dates]);
}

const weekOf = (iso) => {
  const d = new Date(iso);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};
const thisMonday = weekOf(new Date().toISOString());
const wanted = Array.from({ length: weeks }, (_, i) => {
  const d = new Date(thisMonday);
  d.setDate(d.getDate() - 7 * (weeks - 1 - i));
  return d.toISOString().slice(0, 10);
});

console.log(`\nFamilies, and whether each finished a shop — ${weeks} weeks to ${thisMonday}\n`);
console.log(`${'family'.padEnd(22)} ${wanted.map((w) => w.slice(5)).join('  ')}   shops`);
let anyThisWeek = 0;
for (const [id, h] of households) {
  const dates = shops.get(id) ?? [];
  const byWeek = new Set(dates.map(weekOf));
  const marks = wanted.map((w) => (byWeek.has(w) ? ' ✓ ' : ' · ')).join('   ');
  if (byWeek.has(thisMonday)) anyThisWeek += 1;
  console.log(`${(h.name || id).slice(0, 21).padEnd(22)} ${marks}    ${dates.length}`);
}
const n = households.size;
console.log(`\n${anyThisWeek} of ${n} famil${n === 1 ? 'y' : 'ies'} finished a shop this week.`);
if (n >= 10) console.log(anyThisWeek >= n / 2 ? 'Above the bar the plan turns on.' : 'Below the bar: understand why before adding anything.');
