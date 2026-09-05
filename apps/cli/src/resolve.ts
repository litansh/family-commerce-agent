/**
 * `npm run resolve` — brand and size choice for a list.
 *
 * For every line it shows what we would buy and what else the family could
 * have, compared on price per 100ml/100g rather than sticker price. A line that
 * names a brand always gets that brand; rivals are shown, never swapped in.
 *
 * The output is the input to the preference store: once a family confirms a
 * barcode here, that line stops being guessed forever, which is the fix for the
 * 9 suspect lines the first measurement found.
 */

import { buildChoice, formatILS, type ListLine, type ProductChoice } from '@fca/domain';
import { SuperMcpCatalogProvider } from '@fca/retailer-connectors';

export async function resolveList(
  lines: readonly ListLine[],
  location: string,
  concurrency = 4,
): Promise<Map<string, ProductChoice | undefined>> {
  const catalog = new SuperMcpCatalogProvider();
  const out = new Map<string, ProductChoice | undefined>();

  // Modest concurrency: enough to keep 36 lines quick, low enough to stay a
  // plausible household's traffic against a free service.
  const queue = [...lines];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const line = queue.shift();
      if (line === undefined) return;
      try {
        // Ask without the brand filter too: the family needs to see rivals, and
        // a brand-filtered search by definition cannot return any.
        const [branded, open] = await Promise.all([
          line.brand !== undefined
            ? catalog.searchProducts({ query: line.query, brand: line.brand, limit: 12, location })
            : Promise.resolve([]),
          catalog.searchProducts({ query: line.query, limit: 16, location }),
        ]);
        const merged = dedupe([...branded, ...open]);
        out.set(
          line.id,
          buildChoice(merged, {
            lineId: line.id,
            query: line.query,
            ...(line.brand !== undefined ? { requestedBrand: line.brand } : {}),
            ...(line.gtin !== undefined ? { requestedGtin: line.gtin } : {}),
          }),
        );
      } catch {
        out.set(line.id, undefined);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const dedupe = <T extends { productId: string }>(xs: readonly T[]): T[] => [
  ...new Map(xs.map((x) => [x.productId, x])).values(),
];

export function printChoice(choice: ProductChoice | undefined, line: ListLine): void {
  if (choice === undefined) {
    console.log(`\n${line.query}\n  ✖ nothing found`);
    return;
  }

  const askedFor = choice.requestedBrand !== undefined ? `  (asked for ${choice.requestedBrand})` : '';
  console.log(`\n${line.query}${askedFor}`);

  const c = choice.chosen;
  const badge = choice.brandHonoured ? '✓' : ' ';
  console.log(
    `  ${badge} ${trim(c.name, 46).padEnd(48)} ${money(c.fromPrice).padStart(9)}  ${unit(c)}`,
  );
  if (choice.note !== undefined) console.log(`    ⚠ ${choice.note}`);

  for (const alt of choice.alternatives) {
    const a = alt.candidate;
    const marker = (alt.percentDelta ?? 0) > 0 ? '↓' : (alt.percentDelta ?? 0) < 0 ? '↑' : '·';
    console.log(
      `    ${marker} ${trim(a.name, 44).padEnd(46)} ${money(a.fromPrice).padStart(9)}  ${unit(a)}  ${alt.reason}`,
    );
  }
}

const trim = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (a: number | undefined): string => (a === undefined ? '—' : formatILS(a as never));
const unit = (c: { unitPrice?: number; unitBasis?: string }): string =>
  c.unitPrice === undefined
    ? ''.padEnd(18)
    : `${formatILS(c.unitPrice as never)}/${(c.unitBasis ?? '').replace('per_', '')}`.padEnd(18);
