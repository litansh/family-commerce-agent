/**
 * Hatzi Hinam's own stock, gathered nightly from this Mac — never the API's Lambda (ADR 0011:
 * shop.hazi-hinam.co.il only answers a browser, a phone, or this Mac; PR #73 tried the live call
 * from apps/api/src/index.ts during a compare and was reverted for exactly that reason).
 *
 * The universe of barcodes checked is every product any household's memory has ever confirmed
 * (`ProductPreference.gtin`, packages/domain) — the same barcodes a real compare actually quotes.
 * A barcode never checked, or one the guest session did not answer, is simply absent from the
 * cache; the API keeps such lines rather than reading an absence as "not in stock" (ADR 0011:
 * best-effort only, same rule as Rami Levy's branch list).
 *
 * The API only ever reads HOUSEHOLD#CATALOG / HH_STOCK; this script is the only writer that can
 * actually reach Hatzi Hinam's own site.
 *
 *   node --experimental-strip-types services/retailer-connectors/refresh-hazi-hinam-stock.mjs
 *   AWS_PROFILE=personal-cfo (falls back to the SDK's default credential chain)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { HaziHinamStock } from './src/index.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

/** Every barcode any household's memory has confirmed, across every household. */
async function knownGtins() {
  const out = new Set();
  let ExclusiveStartKey;
  do {
    const r = await doc.send(new ScanCommand({
      TableName: TABLE, FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': 'MEMORY' },
      ProjectionExpression: 'products', ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    for (const it of r.Items ?? []) for (const p of Object.values(it['products'] ?? {})) if (p?.gtin) out.add(String(p.gtin));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return [...out];
}

const gtins = await knownGtins();
if (!gtins.length) { console.log('hazi-hinam stock: no known barcodes yet — leaving the previous cache in place'); process.exit(0); }

const inStock = await new HaziHinamStock(15_000).inStock(gtins);
if (!inStock.size) { console.log('hazi-hinam stock: none answered — leaving the previous cache in place'); process.exit(1); }

await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: 'HOUSEHOLD#CATALOG', SK: 'HH_STOCK', stock: Object.fromEntries(inStock), at: new Date().toISOString() } }));
console.log(`hazi-hinam stock cached: ${inStock.size}/${gtins.length} barcodes answered`);
