// Why did no substitute land? Run the real provider on the top-up list and show each step.
import { SuperMcpQuoteProvider, SuperMcpCatalogProvider } from '../retailer-connectors/src/supermcp.ts';
import { substituteMissing } from './src/substitutes.ts';
const p = new SuperMcpQuoteProvider(); const cat = new SuperMcpCatalogProvider();
const address = 'ביאליק 20, רמת גן';
const lines = [['חלב 3% 1 ליטר', 2], ['לחם אחיד פרוס', 1], ['ביצים L', 1], ['פילה סלמון', 1], ['עגבניות', 1], ['מלפפונים', 1], ['במבה', 2], ['נייר טואלט 32', 1]].map(([query, packQty], i) => ({ id: `s${i}`, query, packQty }));
const res = await p.quoteBasket({ lines, address, serviceType: 'delivery' });
const catalog = { searchProducts: async (r) => { const out = await cat.searchProducts(r); console.log(`  search "${r.query}" → ${out.slice(0, 4).map((c) => `${c.name} [${c.gtin ?? '-'}] chains ${c.pricedAtChains}`).join(' | ')}`); return out; } };
const qp = { quoteBasket: async (r) => { const out = await p.quoteBasket(r); console.log(`  second quote for ${r.lines.map((l) => l.query).join(', ')} → ${out.quotes.map((q) => `${q.storefrontId}:${q.lines.map((l) => (l.substituted ? '~' : '') + l.lineId).join('/') || '-'}`).join(' ')}`); return out; } };
const out = await substituteMissing(qp, catalog, res, lines, address);
for (const q of out.quotes) { const ours = q.lines.filter((l) => l.substitutionReason && /→/.test(l.substitutionReason)); if (ours.length) console.log(`${q.storefrontId}: ${ours.map((l) => l.substitutionReason).join('; ')}`); }
console.log('done');
