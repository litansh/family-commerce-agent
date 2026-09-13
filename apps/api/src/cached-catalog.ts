/**
 * A cache in front of catalogue search.
 *
 * A compare looks up an alternative for every line a store cannot fill, and a family of five with
 * a dozen stores means dozens of searches for one basket. The same queries repeat constantly -
 * "חלב", "לחם", "ביצים" are on every list in the country - and their answers change on the scale of
 * days, not seconds. Without this the provider is asked the same question hundreds of times a day,
 * which is both slow for the family and rude to a free service that answers `internal_error` when
 * pushed (ADR 0010's politeness).
 *
 * **Prices are never cached.** What is kept is a product's identity - its barcode, name, brand and
 * size, which change when a manufacturer changes a package, not when a shop changes a shelf label.
 * Every price a family sees comes from the quote or from the live price row, every time. So a stale
 * entry can at worst cost one substitution suggestion; it can never put an old number on a card.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CatalogProvider, CatalogSearchRequest } from '@fca/retailer-connectors';
import { agorot, type ProductCandidate } from '@fca/domain';

const TTL_HOURS = 24;
/** One pull a day per question, shared by every family asking it - unless reality contradicts it, and then `forget`. */
const TTL_S = TTL_HOURS * 3600;

/** One key per question actually asked: the words, the brand filter, and where the family lives. */
export function searchKey(req: CatalogSearchRequest): string {
  const q = (req.gtin ?? req.query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const brand = (req.brand ?? '').trim().toLowerCase();
  // The address decides which storefronts price a product, so it belongs in the key - but only the
  // city, or every house number would have its own cache and share nothing.
  const city = (req.location ?? '').split(',').pop()?.trim().toLowerCase() ?? '';
  return `SEARCH#${city}#${brand}#${q}#${req.limit ?? 0}`;
}

export class CachedCatalog implements CatalogProvider {
  readonly id: string;
  readonly #inner: CatalogProvider;
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;
  /** Two lookups of the same thing in one compare must not become two provider calls. */
  readonly #inflight = new Map<string, Promise<readonly ProductCandidate[]>>();
  #hits = 0;
  #misses = 0;

  constructor(inner: CatalogProvider, table: string, client?: DynamoDBClient) {
    this.#inner = inner;
    this.id = inner.id;
    this.#table = table;
    this.#doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    if (inner.listPromotions) this.listPromotions = (limit: number) => inner.listPromotions!(limit);
    if (inner.listStorefronts) this.listStorefronts = (address: string) => inner.listStorefronts!(address);
  }

  listPromotions?: (limit: number) => Promise<readonly Promotion[]>;
  listStorefronts?: (address: string) => Promise<readonly StorefrontInfo[]>;

  /** How the cache behaved for one compare, for the log line that makes it visible. */
  stats(): { hits: number; misses: number } {
    return { hits: this.#hits, misses: this.#misses };
  }

  /**
   * Put today's prices back on a remembered product. The identity came from the cache; the numbers
   * come from the live `PRICE#<barcode>` rows the refresher keeps, so nothing a family reads is old.
   */
  async #priced(products: readonly ProductCandidate[]): Promise<readonly ProductCandidate[]> {
    const rows = await Promise.all(products.map((p) => (p.gtin
      ? this.#doc.send(new GetCommand({ TableName: this.#table, Key: { PK: 'CATALOG', SK: `PRICE#${p.gtin}` } })).then((r) => r.Item).catch(() => undefined)
      : Promise.resolve(undefined))));
    return products.map((p, i) => {
      const r = rows[i] as { min?: number; prices?: { storefrontId: string }[] } | undefined;
      if (!r) return { ...p, pricedAtChains: 0 } satisfies ProductCandidate;
      const withPrices: ProductCandidate = { ...p, pricedAtChains: new Set((r.prices ?? []).map((x) => x.storefrontId)).size };
      return typeof r.min === 'number' ? { ...withPrices, fromPrice: agorot(r.min) } : withPrices;
    });
  }

  /**
   * Throw away what we remembered about a word, because the world disagreed with it: a product the
   * catalogue offered turned out to be out of stock at the family's branch, or absent from the cart.
   * The next family to ask gets a fresh answer rather than the same disappointment.
   */
  async forget(queries: readonly string[], location?: string): Promise<void> {
    const keys = new Set<string>();
    for (const q of queries) for (const limit of [8, 12, 16, 20]) keys.add(searchKey({ query: q, limit, ...(location ? { location } : {}) }));
    await Promise.all([...keys].map((SK) => this.#doc
      .send(new DeleteCommand({ TableName: this.#table, Key: { PK: 'CATALOG', SK } }))
      .catch(() => undefined)));
  }

  async searchProducts(req: CatalogSearchRequest): Promise<readonly ProductCandidate[]> {
    const key = searchKey(req);
    const already = this.#inflight.get(key);
    if (already) return already;

    const work = (async () => {
      const cached = await this.#doc
        .send(new GetCommand({ TableName: this.#table, Key: { PK: 'CATALOG', SK: key } }))
        .catch(() => undefined);
      const row = cached?.Item as { products?: ProductCandidate[] } | undefined;
      if (row?.products) {
        this.#hits += 1;
        return this.#priced(row.products);
      }
      this.#misses += 1;
      const products = await this.#inner.searchProducts(req);
      // Identity only. `fromPrice`, `unitPrice` and `pricedAtChains` are prices and price coverage,
      // and they go stale in hours - the caller fetches them live (the search route reads PRICE#
      // rows; the compare prices everything through the quote).
      const identity = products.map(({ fromPrice: _f, unitPrice: _u, unitBasis: _b, pricedAtChains: _p, ...rest }) => rest);
      // An empty answer is cached too, briefly: a query nobody sells is asked again and again.
      await this.#doc
        .send(new PutCommand({
          TableName: this.#table,
          Item: { PK: 'CATALOG', SK: key, products: identity, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + (products.length ? TTL_S : 3600) },
        }))
        .catch(() => undefined);
      return products;
    })();

    this.#inflight.set(key, work);
    try {
      return await work;
    } finally {
      this.#inflight.delete(key);
    }
  }
}

type Promotion = Awaited<ReturnType<NonNullable<CatalogProvider['listPromotions']>>>[number];
type StorefrontInfo = Awaited<ReturnType<NonNullable<CatalogProvider['listStorefronts']>>>[number];
