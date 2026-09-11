/**
 * "And if we drive there?" — in-store prices at the branches near home.
 *
 * The chains' price-transparency files are big and slow to fetch, so nothing
 * here happens while a family waits for a quote. A refresher (its own Lambda,
 * nightly and on demand) finds the household's nearby branches, geocodes them
 * once, and turns each branch's daily price file into a small barcode → price
 * index in S3. The quote path only reads those indexes.
 *
 *   HOUSEHOLD#<hid> / BRANCHES     which branches, how far, when indexed
 *   s3 stores/<chain>.json         the chain's branches with cached coordinates
 *   s3 index/<chain>/<store>.json  one branch's prices, by barcode
 *   s3 cbs.json                    settlement code → city name
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { allPortals, branchesInCity, decodeXml, fetchCbs, geocode, nearestBranches, parsePriceFull, priceAtBranch, reverseCity, type Branch, type GeoBranch, type NearbyBranch, type PriceIndex, type SettlementNames } from '@fca/branch-prices';
import { DEFAULT_CONSTANTS, type Agorot } from '@fca/domain';
import { HouseholdStore, type Household } from './households.ts';
import { readRow, writeRow } from './orders.ts';

const DAY = 24 * 3600_000;

export interface IndexedBranch extends NearbyBranch { readonly indexedAt: string; readonly barcodes: number }
export interface BranchRow {
  readonly status: 'ready' | 'pending' | 'none';
  readonly at: string;
  readonly city: string;
  readonly requestedAt?: string;
  readonly branches: readonly IndexedBranch[];
}

/** What the compare screen shows per branch. Cash and driving are reported side by side, never summed for the family. */
export interface DriveView {
  readonly storefrontId: string;
  readonly chain: string;
  readonly brand: string;
  readonly branchName: string;
  readonly address: string;
  readonly distanceKm: number;
  readonly minutes: number;
  readonly itemsSubtotal: Agorot;
  readonly driveCost: Agorot;
  readonly coveredLines: number;
  readonly totalLines: number;
  readonly missingLineIds: readonly string[];
  readonly pricedAt: string;
}

type StoresCache = { at: string; branches: (Branch & { lat?: number; lng?: number })[] };

const homeOf = (h: Household): { lat: number; lng: number; city: string } | undefined => {
  const ad = (h.addressDetails ?? {}) as { lat?: unknown; lng?: unknown; city?: unknown };
  if (typeof ad.lat !== 'number' || typeof ad.lng !== 'number') return undefined;
  const city = typeof ad.city === 'string' && ad.city.trim() ? ad.city.trim() : (h.address.split(',').pop() ?? '').trim();
  return city ? { lat: ad.lat, lng: ad.lng, city } : undefined;
};

export class BranchPrices {
  readonly #s3 = new S3Client({});
  readonly #lambda = new LambdaClient({});
  readonly #table: string;
  readonly #bucket: string;
  readonly #refreshFn: string;
  readonly #indexCache = new Map<string, { at: number; index: PriceIndex }>();

  constructor(table: string, bucket: string, refreshFn: string) { this.#table = table; this.#bucket = bucket; this.#refreshFn = refreshFn; }

  get enabled(): boolean { return !!this.#bucket; }

  async #getJson<T>(key: string): Promise<T | undefined> {
    try {
      const r = await this.#s3.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      return JSON.parse(await r.Body!.transformToString()) as T;
    } catch { return undefined; }
  }
  async #putJson(key: string, value: unknown): Promise<void> {
    await this.#s3.send(new PutObjectCommand({ Bucket: this.#bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' }));
  }

  // --- quote side -------------------------------------------------------------

  /** The in-store view for a quote. Kicks the refresher when the household has none yet or it is a day old. */
  async driveQuotes(hid: string, household: Household, lines: readonly { id: string; query: string; gtin?: string; qty: number }[]): Promise<{ status: BranchRow['status']; branches: DriveView[] }> {
    if (!this.enabled) return { status: 'none', branches: [] };
    const home = homeOf(household) ?? (household.address ? { lat: NaN, lng: NaN, city: (household.address.split(',').pop() ?? '').trim() } : undefined);
    if (!home) return { status: 'none', branches: [] };
    const row = (await readRow(this.#table, hid, 'BRANCHES')) as BranchRow | undefined;
    const stale = !row || Date.now() - Date.parse(row.at) > DAY + 2 * 3600_000;
    const askedRecently = row?.requestedAt && Date.now() - Date.parse(row.requestedAt) < 3600_000;
    if (stale && !askedRecently && this.#refreshFn) {
      await writeRow(this.#table, hid, 'BRANCHES', { ...(row ?? { status: 'pending', at: new Date(0).toISOString(), city: home.city, branches: [] }), requestedAt: new Date().toISOString() });
      await this.#lambda.send(new InvokeCommand({ FunctionName: this.#refreshFn, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ hid })) })).catch((e: unknown) => console.warn('branch refresh invoke failed', e));
    }
    if (!row || row.status !== 'ready') return { status: row?.status === 'none' ? 'none' : 'pending', branches: [] };
    const views: DriveView[] = [];
    for (const b of row.branches) {
      const index = await this.#index(b.chain, b.storeId);
      if (!index) continue;
      const q = priceAtBranch(b, index, lines, DEFAULT_CONSTANTS);
      const priced = new Set(q.quote.lines.map((l) => l.lineId));
      views.push({
        storefrontId: q.quote.storefrontId, chain: b.chain, brand: b.brand, branchName: b.name, address: b.address,
        distanceKm: q.travel.distanceKm, minutes: q.travel.roundTripMinutes,
        itemsSubtotal: q.quote.itemsSubtotal, driveCost: (q.travel.fuelCost + q.travel.parkingCost) as Agorot,
        coveredLines: q.quote.pricedLines, totalLines: lines.length, missingLineIds: lines.filter((l) => !priced.has(l.id)).map((l) => l.id), pricedAt: b.indexedAt,
      });
    }
    // Branches that price most of the list are real alternatives; the rest would mean a second trip.
    // A long list rarely matches half a branch's barcodes, so the best branch is always shown with
    // its coverage stated ("22 מתוך 39") rather than an empty card that explains nothing.
    const cov = (v: DriveView) => (v.totalLines === 0 ? 1 : v.coveredLines / v.totalLines);
    const byValue = [...views].sort((a, b) => a.itemsSubtotal + a.driveCost - (b.itemsSubtotal + b.driveCost));
    let useful = byValue.filter((v) => cov(v) >= 0.5);
    if (useful.length === 0) useful = [...views].sort((a, b) => cov(b) - cov(a)).filter((v) => cov(v) >= 0.3).slice(0, 2);
    return { status: 'ready', branches: useful };
  }

  async #index(chain: string, storeId: string): Promise<PriceIndex | undefined> {
    const key = `index/${chain}/${storeId}.json`;
    const hit = this.#indexCache.get(key);
    if (hit && Date.now() - hit.at < 20 * 60_000) return hit.index;
    const obj = await this.#getJson<{ prices: PriceIndex }>(key);
    if (!obj) return undefined;
    this.#indexCache.set(key, { at: Date.now(), index: obj.prices });
    return obj.prices;
  }

  // --- refresher side ---------------------------------------------------------

  async #cbs(): Promise<SettlementNames> {
    const cached = await this.#getJson<{ at: string; names: SettlementNames }>('cbs.json');
    if (cached && Date.now() - Date.parse(cached.at) < 30 * DAY && Object.keys(cached.names).length > 100) return cached.names;
    const names = await fetchCbs();
    if (Object.keys(names).length > 100) await this.#putJson('cbs.json', { at: new Date().toISOString(), names });
    return Object.keys(names).length ? names : (cached?.names ?? {});
  }

  /** Find, geocode and index the branches near one household. */
  async refreshHousehold(hid: string, household?: Household): Promise<BranchRow> {
    let h = household ?? ((await readRow(this.#table, hid, 'META')) as unknown as Household | undefined);
    const now = new Date().toISOString();
    // A household whose address was typed before the address picker existed has no coordinates:
    // geocode the address once and keep it, so the branches (and Wolt's live ETA) can be found.
    if (h && !homeOf(h) && h.address) {
      const g = await geocode(h.address);
      if (g) {
        const ad: Record<string, unknown> = { ...((h.addressDetails ?? {}) as Record<string, unknown>), lat: g.lat, lng: g.lng };
        if (typeof ad['city'] !== 'string' || !ad['city']) ad['city'] = g.city ?? (h.address.split(',').pop() ?? '').trim();
        h = await new HouseholdStore(this.#table).update(hid, { addressDetails: ad });
      }
    }
    let home = h ? homeOf(h) : undefined;
    // The chains name cities in Hebrew; an English or free-text city ("Ruppin 10 Kfar Saba") matches
    // nothing. Ask the map for the Hebrew settlement at the coordinates and keep it.
    if (h && home && !/[א-ת]/.test(home.city)) {
      const city = await reverseCity(home);
      if (city) {
        const ad: Record<string, unknown> = { ...((h.addressDetails ?? {}) as Record<string, unknown>), city };
        h = await new HouseholdStore(this.#table).update(hid, { addressDetails: ad });
        home = { ...home, city };
      }
    }
    if (!home) {
      const row: BranchRow = { status: 'none', at: now, city: '', branches: [] };
      await writeRow(this.#table, hid, 'BRANCHES', { ...row });
      return row;
    }
    const names = await this.#cbs();
    const geo: GeoBranch[] = [];
    for (const portal of allPortals()) {
      const key = `stores/${portal.chain}.json`;
      let cache = await this.#getJson<StoresCache>(key);
      if (!cache || Date.now() - Date.parse(cache.at) > DAY) {
        try {
          const fresh = await portal.stores();
          if (fresh.length) {
            const known = new Map((cache?.branches ?? []).map((b) => [b.storeId, b]));
            cache = { at: now, branches: fresh.map((b) => { const k = known.get(b.storeId); return k?.lat !== undefined && k.lng !== undefined ? { ...b, lat: k.lat, lng: k.lng } : b; }) };
          }
        } catch (e) { console.warn(`stores ${portal.chain}:`, e instanceof Error ? e.message : e); }
      }
      if (!cache) continue;
      const inCity = branchesInCity(cache.branches, home.city, names);
      let geocoded = 0; let changed = false;
      for (const b of inCity) {
        const c = cache.branches.find((x) => x.storeId === b.storeId && x.subChainId === b.subChainId);
        if (!c) continue;
        if (c.lat === undefined && b.lat !== undefined && b.lng !== undefined) { Object.assign(c, { lat: b.lat, lng: b.lng }); changed = true; }
        if (c.lat === undefined && geocoded < 25) {
          const cityName = /^\d+$/.test(b.city) ? (names[b.city] ?? b.city) : b.city;
          const g = await geocode(`${b.address}, ${cityName}`);
          geocoded += 1; await new Promise((r) => setTimeout(r, 1100));
          if (g) { Object.assign(c, g); changed = true; }
        }
        if (c.lat !== undefined && c.lng !== undefined) geo.push({ ...b, chain: portal.chain, brand: portal.brand, lat: c.lat, lng: c.lng });
      }
      if (changed || cache.at === now) await this.#putJson(key, cache);
    }
    const near = nearestBranches(geo, home, { radiusKm: 12, perChain: 2 });
    const portals = new Map(allPortals().map((p) => [p.chain, p]));
    const branches: IndexedBranch[] = [];
    for (const b of near) {
      const key = `index/${b.chain}/${b.storeId}.json`;
      const existing = await this.#getJson<{ at: string; barcodes: number }>(key);
      if (existing && Date.now() - Date.parse(existing.at) < 20 * 3600_000) { branches.push({ ...b, indexedAt: existing.at, barcodes: existing.barcodes }); continue; }
      try {
        const portal = portals.get(b.chain)!;
        const ref = await portal.priceFile(b.storeId);
        if (!ref) { console.warn(`no price file for ${b.chain} ${b.storeId}`); continue; }
        const pf = parsePriceFull(decodeXml(await portal.download(ref)));
        const barcodes = Object.keys(pf.prices).length;
        if (barcodes < 500) { console.warn(`thin price file for ${b.chain} ${b.storeId}: ${barcodes}`); continue; }
        await this.#putJson(key, { at: now, chain: b.chain, storeId: b.storeId, file: ref.name, barcodes, prices: pf.prices });
        branches.push({ ...b, indexedAt: now, barcodes });
      } catch (e) { console.warn(`index ${b.chain} ${b.storeId}:`, e instanceof Error ? e.message : e); }
    }
    const row: BranchRow = { status: 'ready', at: now, city: home.city, branches };
    await writeRow(this.#table, hid, 'BRANCHES', { ...row });
    return row;
  }

  /** Every household that ever asked: the nightly pass. */
  async refreshAll(): Promise<string[]> {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const done: string[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(new ScanCommand({ TableName: this.#table, FilterExpression: 'SK = :sk', ExpressionAttributeValues: { ':sk': 'BRANCHES' }, ProjectionExpression: 'PK', ExclusiveStartKey }));
      for (const it of r.Items ?? []) {
        const hid = String(it['PK']).replace(/^HOUSEHOLD#/, '');
        try { await this.refreshHousehold(hid); done.push(hid); } catch (e) { console.error(`refresh ${hid}:`, e); }
      }
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return done;
  }
}
