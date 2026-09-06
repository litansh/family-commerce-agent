/**
 * Product images.
 *
 * No aggregator gives us pictures, but three sources do, in order of hit
 * rate on Israeli barcodes:
 *   1. Rami Levy's image host, keyed by GTIN — one URL, no lookup
 *   2. Open Food Facts, keyed by GTIN — global, free, needs one JSON call
 *   3. Shufersal's search, keyed by name — Cloudinary URL per product
 *
 * Results are cached in the main table under IMG#<key> with a 30-day TTL so
 * a household's usual forty items cost one lookup each, ever.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

export interface ImageRef {
  readonly url: string;
  readonly source: 'rami-levy' | 'off' | 'shufersal';
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const TTL_DAYS = 30;
/** A miss is retried sooner: the sources are flaky, and a timeout is not a 404. */
const MISS_TTL_DAYS = 1;

export const ramiLevyImageUrl = (gtin: string): string => `https://img.rami-levy.co.il/product/${gtin}/small.jpg`;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

async function tryRamiLevy(gtin: string): Promise<ImageRef | undefined> {
  const res = await withTimeout(fetch(ramiLevyImageUrl(gtin), { method: 'HEAD', headers: { 'user-agent': UA } }), 1500).catch(() => undefined);
  return res?.ok && (res.headers.get('content-type') ?? '').startsWith('image/jpeg') ? { url: ramiLevyImageUrl(gtin), source: 'rami-levy' } : undefined;
}

async function tryOff(gtin: string): Promise<ImageRef | undefined> {
  const res = await withTimeout(fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=image_front_small_url`, { headers: { 'user-agent': 'kanili/0.1' } }), 2500).catch(() => undefined);
  if (!res?.ok) return undefined;
  const d = (await res.json().catch(() => null)) as { status?: number; product?: { image_front_small_url?: string } } | null;
  const url = d?.product?.image_front_small_url;
  return d?.status === 1 && url ? { url, source: 'off' } : undefined;
}

async function tryShufersal(name: string): Promise<ImageRef | undefined> {
  const q = encodeURIComponent(`${name}:relevance`);
  const res = await withTimeout(fetch(`https://www.shufersal.co.il/online/he/search/results?q=${q}&limit=1`, { headers: { 'user-agent': UA, accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } }), 2500).catch(() => undefined);
  if (!res?.ok) return undefined;
  const d = (await res.json().catch(() => null)) as { results?: { images?: { format?: string; url?: string }[] }[] } | null;
  const url = d?.results?.[0]?.images?.find((i) => i.format === 'product' || i.format === 'thumbnail')?.url;
  return url ? { url, source: 'shufersal' } : undefined;
}

export class ImageResolver {
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;
  readonly #inflight = new Map<string, Promise<ImageRef | null>>();

  constructor(table: string, client?: DynamoDBClient) {
    this.#table = table;
    this.#doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  }

  /** Best image for a product, or null. Never throws; a missing picture is not an error. */
  async resolve(p: { gtin?: string; name?: string }): Promise<ImageRef | null> {
    const key = p.gtin ? `G#${p.gtin}` : p.name ? `N#${p.name.trim().toLowerCase().slice(0, 120)}` : undefined;
    if (!key) return null;
    const running = this.#inflight.get(key);
    if (running) return running;
    const task = this.#resolve(key, p).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, task);
    return task;
  }

  async #resolve(key: string, p: { gtin?: string; name?: string }): Promise<ImageRef | null> {
    const cached = await this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: `IMG#${key}`, SK: 'IMG' } })).catch(() => undefined);
    if (cached?.Item) {
      const it = cached.Item as { url?: string; source?: ImageRef['source']; miss?: boolean };
      return it.miss ? null : it.url && it.source ? { url: it.url, source: it.source } : null;
    }

    let ref: ImageRef | undefined;
    if (p.gtin) ref = (await tryRamiLevy(p.gtin)) ?? (await tryOff(p.gtin));
    if (!ref && p.name) ref = await tryShufersal(p.name);

    const ttl = Math.floor(Date.now() / 1000) + (ref ? TTL_DAYS : MISS_TTL_DAYS) * 86_400;
    await this.#doc
      .send(new PutCommand({ TableName: this.#table, Item: { PK: `IMG#${key}`, SK: 'IMG', ttl, ...(ref ? { url: ref.url, source: ref.source } : { miss: true }) } }))
      .catch(() => undefined);
    return ref ?? null;
  }

  /** Cache lookups only - what is already known, instantly. */
  async cachedMany(items: readonly { key: string; gtin?: string; name?: string }[]): Promise<Record<string, ImageRef | null>> {
    const out: Record<string, ImageRef | null> = {};
    await Promise.all(items.map(async (it) => {
      const key = it.gtin ? `G#${it.gtin}` : it.name ? `N#${it.name.trim().toLowerCase().slice(0, 120)}` : undefined;
      if (!key) { out[it.key] = null; return; }
      const r = await this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: `IMG#${key}`, SK: 'IMG' } })).catch(() => undefined);
      const c = r?.Item as { url?: string; source?: ImageRef['source']; miss?: boolean } | undefined;
      out[it.key] = c?.url && c.source ? { url: c.url, source: c.source } : null;
    }));
    return out;
  }

  /** Resolve many within a time budget; whatever is not done by then comes back null (and is retried next time). */
  async resolveMany(items: readonly { key: string; gtin?: string; name?: string }[], concurrency = 6, budgetMs = 20_000): Promise<Record<string, ImageRef | null>> {
    const out: Record<string, ImageRef | null> = {};
    const queue = [...items];
    const deadline = Date.now() + budgetMs;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (;;) {
          const it = queue.shift();
          if (!it) return;
          if (Date.now() > deadline) { out[it.key] = null; continue; }
          out[it.key] = await this.resolve(it);
        }
      }),
    );
    return out;
  }
}
