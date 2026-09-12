/**
 * Rami Levy's own catalogue, searched by name — the second rung under provider search
 * (docs/adr/0010-every-flow-has-a-fallback.md, Compare). SuperMCP is free and unversioned: it errs
 * with `internal_error` or takes 20-30s often enough that a family typing "טופו" sees nothing. This
 * hits the store's own `/api/catalog?` (the same endpoint `rami-levy-stock.ts` uses for `available_in`
 * and the phone's cart recipe uses to look products up by barcode) with `{q, size}` and answers in
 * well under a second, no session required.
 */
import { resolveBrand, shekels, type ProductCandidate } from '@fca/domain';
import type { CatalogProvider, CatalogSearchRequest } from './quote-provider.ts';

const SITE = 'https://www.rami-levy.co.il';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

interface RawCatalogItem {
  id?: number | string;
  barcode?: number | string;
  name?: string;
  price?: { price?: number | null } | null;
  gs?: { BrandName?: string | null } | null;
}

/** The catalogue's own row shape, kept out of the domain: parsed the same way `supermcp.ts` parses its vendor's. */
export function parseRamiLevyCatalog(items: readonly RawCatalogItem[]): ProductCandidate[] {
  return items.flatMap((it) => {
    if (it.id == null || !it.name) return [];
    const brand = resolveBrand(it.gs?.BrandName, it.name);
    return [{
      productId: `rami-levy:${it.id}`,
      ...(it.barcode != null ? { gtin: String(it.barcode) } : {}),
      name: it.name,
      ...(brand !== undefined ? { brand } : {}),
      ...(it.gs?.BrandName ? { rawBrand: it.gs.BrandName } : {}),
      ...(typeof it.price?.price === 'number' ? { fromPrice: shekels(it.price.price) } : {}),
      // One chain, but a chain that carries it — enough to survive the search route's
      // "pricedAtChains > 0" filter and reach the family as a real, buyable answer.
      pricedAtChains: 1,
    }];
  });
}

export class RamiLevyCatalogSearch implements CatalogProvider {
  readonly id = 'rami-levy';
  readonly #timeoutMs: number;

  constructor(timeoutMs = 3_000) {
    this.#timeoutMs = timeoutMs;
  }

  async searchProducts(req: CatalogSearchRequest, fetchImpl: typeof fetch = fetch): Promise<readonly ProductCandidate[]> {
    const res = await fetchImpl(`${SITE}/api/catalog?`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json', 'user-agent': UA },
      body: JSON.stringify({ q: req.query, size: req.limit ?? 20 }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res.ok) throw new Error(`rami-levy catalog: HTTP ${res.status}`);
    const j = (await res.json()) as { data?: RawCatalogItem[] };
    return parseRamiLevyCatalog(j.data ?? []);
  }
}
