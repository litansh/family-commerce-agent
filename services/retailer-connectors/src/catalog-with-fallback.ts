/**
 * Search's ladder (docs/adr/0010-every-flow-has-a-fallback.md, Compare's second rung): the provider
 * covers every chain but is free and unversioned — it errs (`internal_error`) or answers in 20-30s
 * often enough that a family typing "טופו" or "שוקולד" sees nothing. A chain's own catalogue
 * (starting with Rami Levy) answers in well under a second, so it races the provider rather than
 * waiting for it: whichever answers usably first wins, and a provider that is still slow after the
 * race gets the rest of the time it needs instead of being reported as failed.
 *
 * "Usably" also covers a quieter miss than erring or being slow: the provider naming real products
 * for the query but pricing none of them at any chain right now (measured live, 2026-09-13:
 * `search_products('ביצים')` and `('סלמון')` each answer in under a second with twelve products, every
 * one `pricedAtChains: 0` — `/search` then filters all of them out and the family sees nothing, while
 * Rami Levy's own catalogue prices both). That is not the same as the provider genuinely having
 * nothing for the query (an empty answer, trusted as-is below) — it is a real answer nobody can buy,
 * so the fallback still gets a turn.
 */
import type { ProductCandidate } from '@fca/domain';
import type { CatalogProvider, CatalogSearchRequest, Promotion, StorefrontInfo } from './quote-provider.ts';

type Settled =
  | { readonly kind: 'ok'; readonly products: readonly ProductCandidate[] }
  | { readonly kind: 'err'; readonly error: unknown }
  | { readonly kind: 'timeout' };

export class CatalogWithFallback implements CatalogProvider {
  readonly id: string;
  readonly listStorefronts?: (address: string) => Promise<readonly StorefrontInfo[]>;
  readonly listPromotions?: (limit: number) => Promise<readonly Promotion[]>;
  readonly #primary: CatalogProvider;
  readonly #fallback: Pick<CatalogProvider, 'searchProducts'>;
  readonly #raceMs: number;

  constructor(primary: CatalogProvider, fallback: Pick<CatalogProvider, 'searchProducts'>, raceMs = 2_500) {
    this.id = primary.id;
    this.#primary = primary;
    this.#fallback = fallback;
    this.#raceMs = raceMs;
    if (primary.listStorefronts) this.listStorefronts = primary.listStorefronts.bind(primary);
    if (primary.listPromotions) this.listPromotions = primary.listPromotions.bind(primary);
  }

  async searchProducts(req: CatalogSearchRequest): Promise<readonly ProductCandidate[]> {
    const primaryCall = this.#primary.searchProducts(req);
    const settled = await Promise.race<Settled>([
      primaryCall.then((products) => ({ kind: 'ok', products }), (error: unknown) => ({ kind: 'err', error })),
      new Promise<Settled>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), this.#raceMs)),
    ]);

    // A real empty answer is trusted as-is — the provider knowing nothing about a query is not the
    // failure this ladder exists for. Products nobody prices are a different miss (see above): the
    // fallback still gets a turn, same as an error or a timeout.
    if (settled.kind === 'ok' && (settled.products.length === 0 || settled.products.some((p) => p.pricedAtChains > 0))) {
      return settled.products;
    }

    const fromChain = await this.#fallback.searchProducts(req).catch(() => [] as readonly ProductCandidate[]);
    if (fromChain.length > 0) return fromChain;

    if (settled.kind === 'err') throw settled.error;
    if (settled.kind === 'ok') return settled.products;
    // Slow, and the fallback found nothing either: give the provider the rest of the time it needs
    // rather than reporting a family's search as empty.
    return primaryCall;
  }
}
