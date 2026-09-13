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
 * What is cached is the catalogue's *answer about products*, never a price: prices come from the
 * quote, every time. A cached answer that turns out to be wrong costs a substitution suggestion,
 * never a wrong number on a card.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CatalogProvider, CatalogSearchRequest } from '@fca/retailer-connectors';
import type { ProductCandidate } from '@fca/domain';

const TTL_HOURS = 12;
/** Long enough that a day's compares share their lookups, short enough that a new product appears the same day. */
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
        return row.products;
      }
      this.#misses += 1;
      const products = await this.#inner.searchProducts(req);
      // An empty answer is cached too, briefly: a query nobody sells is asked again and again.
      await this.#doc
        .send(new PutCommand({
          TableName: this.#table,
          Item: { PK: 'CATALOG', SK: key, products, at: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + (products.length ? TTL_S : 3600) },
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
