/**
 * מבצעים, second rung: named deals read straight from the chains' own PromoFull files, for when
 * the pricing provider's own promotions feed is thin or one-sided (docs/BACKLOG.md; ops/deals-health.mjs
 * is what catches a feed dominated by one chain). Every chain publishes its promotions chain-wide, so
 * a handful of branches per chain is enough to see them.
 *
 * Runs from the ops Mac, never from the API or a Lambda (ADR 0011: price files and promotions are
 * read here; the API's /deals route only reads what this writes, at CATALOG#PROMOS_FILES).
 *
 *   node --experimental-strip-types services/branch-prices/refresh-deals.mjs
 *   AWS_PROFILE=personal-cfo (falls back to the SDK's default credential chain)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { allPortals, decodeXml, parsePromoFeed } from './src/index.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';
const BRANCHES_PER_CHAIN = 5;
const CAP_PER_CHAIN = 60;
// Not every branch of a chain publishes the same promotions the same morning (hazi-hinam: branch 103
// had a PromoFull file, 100-102 didn't) - a small chain is cheap to check whole, so don't sample it.
const sample = (stores) => (stores.length <= 10 ? stores : stores.slice(0, BRANCHES_PER_CHAIN));

const byChain = new Map();
for (const portal of allPortals()) {
  const t0 = Date.now();
  try {
    const stores = await portal.stores();
    if (!stores.length) { console.log(`${portal.chain.padEnd(16)} no stores file`); continue; }
    const seen = new Map();
    for (const b of sample(stores)) {
      try {
        const ref = await portal.promoFile(b.storeId);
        if (!ref) continue;
        const xml = decodeXml(await portal.download(ref));
        for (const item of parsePromoFeed(xml)) {
          const key = `${item.itemCodes.join(',')}|${item.description}`;
          if (!seen.has(key)) seen.set(key, { ...item, chainName: portal.brand });
        }
      } catch (e) { console.log(`   ${portal.chain} ${b.storeId}: ${String(e).slice(0, 100)}`); }
    }
    const kept = [...seen.values()].sort((a, b) => b.discountRate - a.discountRate).slice(0, CAP_PER_CHAIN);
    if (kept.length) byChain.set(portal.brand, kept);
    console.log(`${portal.chain.padEnd(16)} ${kept.length} named deals from ${sample(stores).length} branch(es)  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) { console.log(`${portal.chain.padEnd(16)} FAILED ${String(e).slice(0, 120)}`); }
}

const promos = [...byChain.values()].flat();
const chains = [...byChain.keys()];
console.log(`\n${promos.length} named deals across ${chains.length} chain(s): ${chains.join(', ')}`);
if (chains.length < 2) { console.log('fewer than two chains produced a deal — leaving the previous cache in place'); process.exit(1); }

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: 'HOUSEHOLD#CATALOG', SK: 'PROMOS_FILES', promos, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 2 * 86400 } }));
console.log('written to CATALOG#PROMOS_FILES');
