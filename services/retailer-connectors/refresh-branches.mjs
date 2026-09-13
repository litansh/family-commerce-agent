/**
 * Rami Levy's online branches, geocoded and placed on the map — from this Mac, never the API's
 * Lambda (ADR 0011: Rami Levy's own `/api/stores` answers a data centre with a block page; the
 * refresher's own attempt in `apps/api/src/refresh.ts` is a Lambda and is expected to fail there,
 * best-effort only). The compare needs to know which branch will fill a family's basket before
 * their first order — Kfar Saba has no online branch of its own, and the site's default branch is
 * an hour away, which is how an out-of-stock line reaches a family at the till. Geocoding is one
 * request a second, so it belongs here, nightly, not in a quote.
 *
 * The API only ever reads CATALOG#RL_BRANCHES; this script is the only writer that can actually
 * reach Rami Levy's own site.
 *
 *   node --experimental-strip-types services/retailer-connectors/refresh-branches.mjs
 *   AWS_PROFILE=personal-cfo (falls back to the SDK's default credential chain)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { geocode } from '@fca/branch-prices';
import { RamiLevyStock } from './src/index.ts';

const TABLE = process.env['TABLE_NAME'] ?? 'fca-main';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

const list = await new RamiLevyStock(15_000).branches();
if (!list.length) { console.log('rami-levy branches: none answered — leaving the previous cache in place'); process.exit(1); }

const row = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: 'HOUSEHOLD#CATALOG', SK: 'RL_BRANCHES' } }));
const prev = new Map((row.Item?.['branches'] ?? []).map((b) => [b.id, b]));

const placed = [];
for (const b of list) {
  const had = prev.get(b.id);
  if (typeof had?.lat === 'number') { placed.push({ ...b, lat: had.lat, lng: had.lng }); continue; }
  const q = [b.street, b.houseNumber, b.city].filter(Boolean).join(' ');
  const at = q ? await geocode(`${q}, ישראל`).catch(() => undefined) : undefined;
  placed.push(at ? { ...b, lat: at.lat, lng: at.lng } : b);
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
}

await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: 'HOUSEHOLD#CATALOG', SK: 'RL_BRANCHES', branches: placed, at: new Date().toISOString() } }));
console.log(`rami-levy online branches on the map: ${placed.filter((b) => typeof b.lat === 'number').length}/${placed.length}`);
