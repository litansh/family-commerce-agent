// Where does the compare's time go? Runs the compare's provider stages from this Mac, in the order
// buildCompare (apps/api/src/index.ts) runs them, and prints each one's time. No AWS, no store's own
// site: only the provider (SuperMCP) and Wolt's public feed, one compare at a time.
//   node --experimental-strip-types services/shopping-agent/lab-compare-timing.mjs [shopper|chaos] [--before]
// The lists are ops/test-cart.mjs's week for five and ops/chaos.mjs's chaotic list (same seed).
import { SuperMcpQuoteProvider, SuperMcpCatalogProvider } from '../retailer-connectors/src/supermcp.ts';
import { woltEtasNear } from '../retailer-connectors/src/wolt-eta.ts';
import { buildChoice, repairQuery, hasWordToQuote, emptyMemory, optimize, DEFAULT_CONSTANTS, isRealAlternative } from '../../packages/domain/src/index.ts';
import { quoteWithFallback } from './src/quote-with-fallback.ts';
import { substituteMissing } from './src/substitutes.ts';
import { substitutesMs } from '../../apps/api/src/compare-budget.ts';
import { withDeadline } from '../../apps/api/src/deadline.ts';

const which = process.argv[2] ?? 'shopper';
// --before: send every non-blank line to the quote, as buildCompare did before 2026-10-10.
const BEFORE = process.argv.includes('--before');
const address = 'ביאליק 20, רמת גן';
const at = { lat: 32.0837, lng: 34.8139 };
const WEEK = [
  ['חלב 3% 1 ליטר', 4], ['קוטג\' 5%', 3], ['גבינה צהובה פרוסה', 2], ['יוגורט תות', 6], ['חמאה', 2], ['ביצים L', 2],
  ['לחם אחיד פרוס', 3], ['פיתות', 2], ['חלה', 1], ['קורנפלקס', 2], ['שיבולת שועל', 1],
  ['אורז בסמטי', 2], ['פסטה פנה', 3], ['קמח לבן', 1], ['סוכר', 1], ['שמן זית', 1], ['שמן קנולה', 1], ['רוטב עגבניות', 3], ['טונה בשמן', 6], ['חומוס', 2], ['טחינה גולמית', 1],
  ['חזה עוף', 2], ['פילה סלמון', 1], ['בשר טחון', 1], ['נקניקיות עוף', 1],
  ['עגבניות', 2], ['מלפפונים', 2], ['בננות', 2], ['תפוחים', 2], ['בצל', 1], ['תפוחי אדמה', 1],
  ['במבה', 4], ['ביסלי', 4], ['שוקולד פרה', 3], ['מים מינרליים 6', 2],
  ['נייר טואלט 32', 1], ['אבקת כביסה', 1], ['סבון כלים', 1], ['שקיות אשפה', 1],
];
const CHAOS = [
  { id: 'x-typo', query: 'מלפפונימ', packQty: 2 }, { id: 'x-mixed', query: 'חלב milk 3%', packQty: 1 },
  { id: 'x-fake-gtin', query: 'לא קיים', gtin: '9999999999999', packQty: 1 }, { id: 'x-dup-a', query: 'בננות', packQty: 2 },
  { id: 'x-dup-b', query: 'בננות', packQty: 3 }, { id: 'x-qty90', query: 'מים מינרליים 6', packQty: 90 },
  { id: 'x-long', query: 'א'.repeat(200), packQty: 1 }, { id: 'x-emoji', query: '🍕🥑🧻🔥🥩', packQty: 1 },
  { id: 'x-empty', query: '', packQty: 1 }, { id: 'x-number', query: '12345', packQty: 1 },
  { id: 'x-never', query: 'מיץ קקטוס קפוא נדיר מהחלל', packQty: 1 }, { id: 'x-tofu', query: 'טופו', packQty: 1 }, { id: 'x-choc', query: 'שוקולד', packQty: 1 },
];
const list = which === 'chaos'
  ? [...WEEK.map(([query, packQty], i) => ({ id: `b${i}`, query, packQty })), ...CHAOS]
  : WEEK.map(([query, packQty], i) => ({ id: `t${i}`, query, packQty }));

const quoteP = new SuperMcpQuoteProvider();
const cat = new SuperMcpCatalogProvider();
const log = [];
const timed = async (stage, work) => { const t = Date.now(); try { return await work(); } finally { const ms = Date.now() - t; log.push([stage, ms]); console.log(`  ${stage}: ${(ms / 1000).toFixed(1)}s`); } };
async function mapLimit(xs, n, f) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const x = xs[i++]; await f(x); } })); }

// Resolve, as /resolve does (four at a time, a second search with the repaired words).
// Resolved once and kept in /tmp, so a rerun asks the provider only for the compare's own calls.
const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
const keep = `/tmp/kaniti-lab-resolved-${which}.json`;
const gtins = new Map(existsSync(keep) ? Object.entries(JSON.parse(readFileSync(keep, 'utf8'))) : []);
if (gtins.size === 0) await timed('resolve (not part of the compare)', () => mapLimit(list, 4, async (l) => {
  if (!l.query.trim()) return;
  const found = await cat.searchProducts({ query: l.query, limit: 16, location: address }).catch(() => []);
  let c = buildChoice(found, { lineId: l.id, query: l.query, ...(l.gtin ? { requestedGtin: l.gtin } : {}) });
  const rep = c ? undefined : repairQuery(l.query);
  if (rep) c = buildChoice(await cat.searchProducts({ query: rep, limit: 16, location: address }).catch(() => []), { lineId: l.id, query: rep });
  const g = c?.chosen?.gtin ?? c?.gtin; if (g) gtins.set(l.id, g);
}));
if (!existsSync(keep)) writeFileSync(keep, JSON.stringify(Object.fromEntries(gtins)));
const lines = list.map((l) => (gtins.get(l.id) && !l.gtin ? { ...l, gtin: gtins.get(l.id) } : l)).filter((l) => l.gtin || (BEFORE ? l.query.trim() !== '' : hasWordToQuote(l.query)));
console.log(`${which}: ${lines.length} lines to quote, ${lines.filter((l) => l.gtin).length} with a barcode`);

const t0 = Date.now();
const woltP = woltEtasNear(at.lat, at.lng).catch(() => ({}));
// Wolt's feed depends only on the address; production asks for it after everything else.
let pass = 0;
const counted = { quoteBasket: (r) => timed(`quote pass ${++pass} (${r.lines.length} lines)`, () => quoteP.quoteBasket(r)) };
// As the sync route runs it (apps/api/src/index.ts buildCompare): one 26 s try for both passes.
const SYNC = { tryMs: 26_000, totalMs: 26_000 };
// A provider abort (22 s) or the 26 s deadline is what production answers as 503 stores_slow.
const res = await timed('quote (quoteWithFallback)', () => withDeadline(quoteWithFallback(counted, { lines, address, serviceType: 'delivery' }, emptyMemory('lab')), SYNC.tryMs))
  .catch((e) => { console.log(`503 stores_slow, as the sync route answers it: ${e?.name ?? e} after ${((Date.now() - t0) / 1000).toFixed(1)}s`); process.exit(2); });
const subCat = { searchProducts: (r) => cat.searchProducts(r) };
// Capped as production caps it (compare-budget.ts substitutesMs): 9 s, and never past 27 s.
const subsMs = substitutesMs(SYNC, Date.now() - t0);
const subs = await timed(`substitutes (cap ${(subsMs / 1000).toFixed(1)}s)`, () => Promise.race([
  // A failed substitutes step keeps the quote, as buildCompare does (apps/api/src/index.ts).
  substituteMissing({ quoteBasket: (r) => timed(`substitutes requote (${r.lines.length} lines)`, () => quoteP.quoteBasket(r)) }, subCat, res, lines, address, 12).catch((e) => { console.log(`  substitutes failed: ${e?.name ?? e}`); return res; }),
  new Promise((r) => setTimeout(() => { console.log('  substitutes skipped at their cap'); r(res); }, subsMs).unref()),
]));
const result = optimize({ quotes: subs.quotes, constants: DEFAULT_CONSTANTS, requestedLineIds: lines.map((l) => l.id) });
const bestId = result.options[0]?.legs[0]?.storefrontId;
const bestLines = subs.quotes.find((q) => q.storefrontId === bestId)?.lines ?? [];
const need = bestLines.filter((l) => !l.gtin && !l.link && l.productName).slice(0, 24);
await timed(`barcodes (${need.length} searches)`, () => mapLimit(need, 4, async (l) => { const hits = await cat.searchProducts({ query: l.productName, limit: 4, location: address }).catch(() => []); hits.find((c) => c.gtin && isRealAlternative(l.productName, c.name)); }));
await timed('wolt etas (started beside the quote)', () => woltP);
const total = Date.now() - t0;
console.log(`compare stages, as the sync route runs them: ${(total / 1000).toFixed(1)}s (images ≤5s, eta enrichment ≤4s and drive not measured here); options ${result.options.length}, best ${bestId}`);
console.log(JSON.stringify({ which, lines: lines.length, totalMs: total, stages: Object.fromEntries(log) }));
console.log('rejected:', result.rejected.map((r) => `${r.storefrontId}:${r.code}:${r.pricedLines}/${r.requestedLines}`).join(' '));
console.log('options:', result.options.map((o) => `${o.kind} ${o.cashCost} cov ${Math.round(o.coverageRatio * 100)}% ${o.legs.map((l) => l.storefrontId + ':' + l.lineIds.length).join('+')}`).join(' | '));
