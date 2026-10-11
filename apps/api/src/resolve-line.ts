/**
 * One line of POST /households/{hid}/resolve: the family's words to a product choice, or nothing.
 *
 * Two rungs (ADR 0010): the words as typed, and the same words as the catalogue spells them
 * (`repairQuery`: "מלפפונימ" → "מלפפונים", "חלב milk 3%" → "חלב 3%"). They start together and each
 * has its own deadline, so one rung failing never takes the other down. Until 2026-10-11 the repaired
 * search ran only after the first one answered, and a deadline on either threw the whole line into
 * `unresolved`: on a slow-provider morning (the chaotic list's /resolve at 13.5-14.5 s on 10-07, 10-09
 * and 10-11, every one with the mixed line red; 4-5 s on the mornings it was green) the line was lost
 * even though the repaired search would have answered.
 */
import { buildChoice, repairQuery, type ProductChoice } from '@fca/domain';
import type { CatalogProvider } from '@fca/retailer-connectors';
import { withDeadline } from './deadline.ts';

export interface ResolveLineInput {
  readonly id: string;
  readonly query: string;
  readonly brand?: string;
  readonly gtin?: string;
}

/** Undefined when nothing honestly answers the line; throws only when every rung that ran failed. */
export async function resolveLine(
  catalog: Pick<CatalogProvider, 'searchProducts'>,
  line: ResolveLineInput,
  location: string | undefined,
  budgetMs: number,
): Promise<ProductChoice | undefined> {
  const at = location !== undefined ? { location } : {};
  const opts = {
    lineId: line.id, query: line.query,
    ...(line.brand ? { requestedBrand: line.brand } : {}),
    ...(line.gtin ? { requestedGtin: line.gtin } : {}),
  };
  const repaired = repairQuery(line.query);
  const first = withDeadline(Promise.all([
    line.brand ? catalog.searchProducts({ query: line.query, brand: line.brand, limit: 12, ...at }) : Promise.resolve([]),
    catalog.searchProducts({ query: line.query, limit: 16, ...at }),
  ]), budgetMs).then(([branded, open]) => [...new Map([...branded, ...open].map((p) => [p.productId, p])).values()]);
  const second = repaired ? withDeadline(catalog.searchProducts({ query: repaired, limit: 16, ...at }), budgetMs) : undefined;
  // Neither rung may reject unobserved while the other is awaited.
  const [a, b] = await Promise.allSettled([first, second ?? Promise.resolve(undefined)]);

  if (a.status === 'fulfilled') {
    const c = buildChoice(a.value, opts);
    if (c) return c;
  }
  if (repaired && b.status === 'fulfilled' && b.value) {
    const r = buildChoice(b.value, { ...opts, query: repaired });
    if (r) return { ...r, query: line.query, note: `Searched as "${repaired}"` };
  }
  // Every rung that ran failed outright: the caller logs it and lists the line unresolved.
  if (a.status === 'rejected' && (!repaired || b.status === 'rejected')) throw a.reason;
  return undefined;
}
