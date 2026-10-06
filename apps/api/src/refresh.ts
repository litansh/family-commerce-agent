/**
 * The branch-price refresher: a Lambda of its own (long timeout, more memory)
 * that reads the chains' daily price files for the branches near each household.
 * Invoked nightly by a schedule, and by the API when a household first asks.
 */
import { BranchPrices } from './branches.ts';
import { geocode } from '@fca/branch-prices';
import { RamiLevyStock } from '@fca/retailer-connectors';
import { CachedCatalog } from './cached-catalog.ts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { providersFor } from './providers.ts';
import { regionOf } from '@fca/domain';
import { readRow, writeRow } from './orders.ts';

const svc = new BranchPrices(process.env['TABLE_NAME'] ?? 'fca-main', process.env['BRANCH_BUCKET'] ?? '', '');

/**
 * Rami Levy's online branches, placed on the map once a night. The compare needs to know which
 * branch will fill a family's basket before their first order - Kfar Saba has no online branch of
 * its own, and the site's default branch is an hour away, which is how an out-of-stock line reaches
 * a family at the till. Geocoding is one request a second, so it belongs here, not in a quote.
 *
 * ADR 0011: this Lambda call to Rami Levy's own site is expected to fail (a data centre gets a
 * block page) and is best-effort only, kept for the rare case it slips through; the ops Mac's
 * `services/retailer-connectors/refresh-branches.mjs`, run nightly, is what actually reaches Rami
 * Levy and writes this row - the source of truth this handler only ever tries to add to.
 */
async function placeRamiLevyBranches(): Promise<number> {
  const list = await new RamiLevyStock(15_000).branches();
  if (!list.length) return 0;
  const prev = new Map<number, { lat?: number; lng?: number }>();
  const row = (await readRow(process.env['TABLE_NAME'] ?? 'fca-main', 'CATALOG', 'RL_BRANCHES')) as { branches?: { id: number; lat?: number; lng?: number }[] } | undefined;
  for (const b of row?.branches ?? []) prev.set(b.id, b);
  const placed = [];
  for (const b of list) {
    const had = prev.get(b.id);
    if (typeof had?.lat === 'number') { placed.push({ ...b, lat: had.lat, lng: had.lng }); continue; }
    const q = [b.street, b.houseNumber, b.city].filter(Boolean).join(' ');
    const at = q ? await geocode(`${q}, ישראל`).catch(() => undefined) : undefined;
    placed.push(at ? { ...b, lat: at.lat, lng: at.lng } : b);
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
  }
  await writeRow(process.env['TABLE_NAME'] ?? 'fca-main', 'CATALOG', 'RL_BRANCHES', { branches: placed, at: new Date().toISOString() });
  return placed.filter((b) => typeof b.lat === 'number').length;
}

/**
 * Fill the catalogue cache once a night, so no family pays for the first lookup of the day.
 *
 * The words are the ones families actually use: every line in every household's memory, plus the
 * staples that are on every list in the country. One pull each, four at a time, and the answers are
 * then shared by everyone who asks that day (`CachedCatalog`). A family reporting an item out of
 * stock throws its word away immediately; this only refills what nobody has contradicted.
 */
const STAPLES = ['חלב', 'לחם', 'ביצים', 'קוטג', 'יוגורט', 'חמאה', 'גבינה צהובה', 'שמנת', 'אורז', 'פסטה', 'קמח', 'סוכר', 'שמן זית', 'טונה', 'עגבניות', 'מלפפון', 'בצל', 'תפוחי אדמה', 'גזר', 'בננות', 'תפוחים', 'עוף', 'שניצל', 'בשר טחון', 'סלמון', 'שוקולד', 'עוגיות', 'קפה', 'תה', 'נייר טואלט', 'מגבונים', 'סבון', 'שמפו', 'אבקת כביסה', 'שקיות אשפה', 'במבה', 'טופו'];

/** Every household that has told us where it lives: the addresses the day's lookups should be warm for. */
async function householdsWithAddress(table: string): Promise<{ id: string; address: string; country?: string }[]> {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const out: { id: string; address: string; country?: string }[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(new ScanCommand({
      TableName: table, FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': 'META' },
      ProjectionExpression: 'PK, address, country', ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    for (const it of r.Items ?? []) {
      if (typeof it['address'] === 'string') out.push({ id: String(it['PK']).replace(/^HOUSEHOLD#/, ''), address: it['address'], ...(typeof it['country'] === 'string' ? { country: it['country'] } : {}) });
    }
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

async function warmCatalogCache(): Promise<{ warmed: number; households: number }> {
  const table = process.env['TABLE_NAME'] ?? 'fca-main';
  const metas = await householdsWithAddress(table).catch(() => [] as { id: string; address: string; country?: string }[]);
  const words = new Set<string>(STAPLES);
  for (const m of metas) {
    const mem = await readRow(table, m.id, 'MEMORY').catch(() => undefined) as { products?: Record<string, { query?: string }> } | undefined;
    for (const p of Object.values(mem?.products ?? {})) if (p.query) words.add(p.query);
  }
  const address = metas[0]?.address ?? 'תל אביב';
  const providers = providersFor(regionOf(metas[0]?.country));
  if (!providers) return { warmed: 0, households: metas.length };
  const catalog = new CachedCatalog(providers.catalog, table);
  const list = [...words];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
    for (let i = next++; i < list.length; i = next++) {
      await catalog.searchProducts({ query: list[i]!, limit: 16, location: address }).catch(() => []);
    }
  }));
  return { warmed: list.length, households: metas.length };
}

export async function handler(event: { hid?: string } | undefined): Promise<{ refreshed: string[] }> {
  if (event?.hid) {
    const row = await svc.refreshHousehold(event.hid);
    console.log(`refreshed ${event.hid}: ${row.status}, ${row.branches.length} branches`);
    return { refreshed: [event.hid] };
  }
  const warm = await warmCatalogCache().catch((e: unknown) => { console.warn('catalogue cache not warmed', e instanceof Error ? e.message : String(e)); return { warmed: 0, households: 0 }; });
  console.log(JSON.stringify({ event: 'catalog-warmed', ...warm }));
  const placed = await placeRamiLevyBranches().catch((e: unknown) => { console.warn('rami-levy branches not placed', e instanceof Error ? e.message : String(e)); return 0; });
  console.log(`rami-levy online branches on the map: ${placed}`);
  const done = await svc.refreshAll();
  console.log(`nightly: ${done.length} households`);
  return { refreshed: done };
}
